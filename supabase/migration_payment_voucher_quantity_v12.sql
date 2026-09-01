-- v12 — كمية وسعر وحدة سندات الصرف
-- آمن لإعادة التشغيل ومتوافق مع السجلات/الاستدعاءات القديمة التي كانت تحفظ amount فقط.

alter table public.payment_vouchers
  add column if not exists quantity double precision not null default 1,
  add column if not exists unit_amount double precision not null default 0;

update public.payment_vouchers
   set quantity = 1,
       unit_amount = amount
 where unit_amount <= 0
   and amount > 0;

alter table public.payment_vouchers
  drop constraint if exists payment_vouchers_quantity_positive,
  drop constraint if exists payment_vouchers_unit_amount_nonnegative;

alter table public.payment_vouchers
  add constraint payment_vouchers_quantity_positive check (quantity > 0),
  add constraint payment_vouchers_unit_amount_nonnegative check (unit_amount >= 0);

create or replace function public.normalize_payment_voucher_amount()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.quantity is null or new.quantity <= 0 then
    raise exception 'عدد وحدات المصروف يجب أن يكون أكبر من صفر.';
  end if;

  -- توافق مع أي تكامل قديم ما زال يرسل amount وحده.
  if tg_op = 'UPDATE' then
    if new.amount is distinct from old.amount
       and new.quantity is not distinct from old.quantity
       and new.unit_amount is not distinct from old.unit_amount then
      new.unit_amount := round((new.amount / new.quantity)::numeric, 2)::double precision;
    end if;
  end if;

  if new.unit_amount is null or new.unit_amount <= 0 then
    if coalesce(new.amount, 0) <= 0 then
      raise exception 'قيمة وحدة المصروف يجب أن تكون أكبر من صفر.';
    end if;
    new.unit_amount := round((new.amount / new.quantity)::numeric, 2)::double precision;
  end if;

  new.amount := round((new.quantity * new.unit_amount)::numeric, 2)::double precision;
  if new.amount <= 0 then
    raise exception 'إجمالي سند الصرف يجب أن يكون أكبر من صفر.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_normalize_payment_voucher_amount on public.payment_vouchers;
create trigger trg_normalize_payment_voucher_amount
before insert or update of quantity, unit_amount, amount on public.payment_vouchers
for each row execute function public.normalize_payment_voucher_amount();
