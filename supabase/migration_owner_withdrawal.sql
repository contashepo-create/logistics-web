-- ============================================================================
-- «سحب نقدي لصاحب المنشأة / مصاريف خاصة بالمالك» في سندات الدفع
-- يسمح بتسجيل سحب نقدي من الخزينة/البنك للمالك، ويُخصم من الأرباح في تقرير P&L
-- الصق هذا الملف في Supabase Dashboard > SQL Editor > Run (آمن التكرار).
-- ============================================================================

alter table public.payment_vouchers drop constraint if exists payment_vouchers_voucher_type_check;
alter table public.payment_vouchers drop constraint if exists payment_vouchers_voucher_type_chk;
alter table public.payment_vouchers
  add constraint payment_vouchers_voucher_type_chk
  check (voucher_type in ('trip', 'advance', 'vehicle', 'general', 'supplier', 'owner'));
