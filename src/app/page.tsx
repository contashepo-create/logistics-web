import Link from "next/link";
import { LandingDeveloperFooter, CopyrightLine } from "@/components/DeveloperInfo";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "نظام النقل المحاسبي — إدارة فواتير ورحلات وسائقي شركتك في مكان واحد",
  description:
    "نظام محاسبي سحابي متكامل لشركات النقل والنولون: فواتير نقل، سندات قبض ودفع، خزائن وبنوك، رواتب، وتقارير أرباح فورية.",
};

const FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: "🧾", title: "فواتير النقل والرحلات", body: "أنشئ فاتورة نقل بكل بنودها — العميل، السيارة، السائق، النولون، والمصروفات — واحسب ربح كل رحلة تلقائياً." },
  { icon: "💵", title: "سندات القبض والدفع", body: "تحصيل من العملاء وصرف للموردين والسائقين مع ترحيل فوري للخزائن والبنوك ورصيد لحظي دقيق." },
  { icon: "🏦", title: "الخزائن والبنوك", body: "تعدد الخزائن والحسابات البنكية، تحويلات داخلية، وأرصدة محدَّثة لحظة بلحظة بلا جرد يدوي." },
  { icon: "👷", title: "الموظفون والسائقون", body: "ملف كامل لكل موظف وسائق، سلف ومستحقات، وكشف حساب تفصيلي في أي وقت." },
  { icon: "💰", title: "مسيّر الرواتب", body: "احتساب الرواتب شهرياً مع الحوافز والخصومات والسلف، وصرفها من الخزينة بقيد واحد." },
  { icon: "🚚", title: "أسطول السيارات", body: "تكلفة وإيراد كل سيارة، مصروفات الصيانة والوقود، وتقرير أداء يوضح المركبة الأكثر ربحية." },
  { icon: "📊", title: "تقارير ذكية", body: "أرباح الرحلات، كشوف حسابات العملاء والموظفين، أداء السيارات، وقائمة الأرباح والخسائر (P&L)." },
  { icon: "📤", title: "تصدير Excel و PDF", body: "صدّر أي شاشة أو تقرير بضغطة واحدة إلى Excel أو PDF جاهز للطباعة والاعتماد." },
  { icon: "🗓️", title: "سنوات مالية مستقلة", body: "افتح سنة مالية جديدة وأقفل السابقة مع الاحتفاظ بكل البيانات التاريخية قابلة للمراجعة." },
  { icon: "🔒", title: "عزل كامل للبيانات", body: "بيانات كل شركة معزولة على مستوى قاعدة البيانات (Row Level Security) — لا أحد يرى بيانات غيره." },
  { icon: "☁️", title: "سحابي بالكامل", body: "اعمل من المكتب أو الجوال أو من الطريق. لا تثبيت ولا نسخ احتياطي يدوي — كل شيء محفوظ لحظياً." },
  { icon: "🇪🇬", title: "عربي بالكامل RTL", body: "واجهة عربية من اليمين لليسار، أرقام وتواريخ محلية، ومصطلحات محاسبية مألوفة لفريقك." },
];

const STEPS = [
  { n: "1", title: "أنشئ حساب شركتك", body: "دقيقة واحدة ببريد إلكتروني — بلا بطاقة بنكية وبلا تثبيت برامج." },
  { n: "2", title: "أدخل بياناتك الأساسية", body: "العملاء، السائقون، السيارات، الخزائن والبنوك — أو ابدأ مباشرة بأول فاتورة." },
  { n: "3", title: "شغّل عملياتك اليومية", body: "فواتير نقل وسندات قبض ودفع ورواتب، والنظام يرحّل القيود نيابة عنك." },
  { n: "4", title: "راقب أرباحك", body: "تقارير لحظية توضح ربح كل رحلة وسيارة وعميل، وقائمة أرباح وخسائر جاهزة." },
];

const PLANS = [
  { name: "الباقة التجريبية", price: "0", unit: "لمدة ٧ أيام", features: ["كل المزايا بلا استثناء", "بلا بطاقة بنكية", "تبدأ تلقائياً عند التسجيل", "بياناتك تبقى بعد الترقية"], cta: "ابدأ التجربة", highlight: false },
  { name: "الاشتراك الشهري", price: "١٠٠", unit: "جنيه / شهرياً — غير شامل الضريبة", features: ["فواتير وسندات بلا حد", "كل التقارير والتصدير", "قناة دعم مباشرة مع المطوّر", "نسخ احتياطي تلقائي"], cta: "اشترك شهرياً", highlight: true },
  { name: "الاشتراك السنوي", price: "١٠٠٠", unit: "جنيه / سنوياً — بخصم ٢٠٠ جنيه", features: ["كل مزايا الباقة الشهرية", "توفير ٢٠٠ جنيه سنوياً", "أولوية في الدعم", "أولوية في طلبات التطوير"], cta: "اشترك سنوياً", highlight: false },
];

const FAQ = [
  { q: "هل أحتاج خبرة محاسبية لاستخدام النظام؟", a: "لا. الشاشات مبنية بلغة تشغيلية (فاتورة نقل، سند قبض، مسيّر رواتب) والنظام يتولى القيود المحاسبية خلف الكواليس." },
  { q: "أين تُحفظ بياناتي؟", a: "على خوادم سحابية آمنة مع تشفير الاتصال ونسخ احتياطي تلقائي، وعزل كامل لبيانات كل شركة على مستوى قاعدة البيانات." },
  { q: "هل يمكنني تصدير بياناتي في أي وقت؟", a: "نعم، كل الشاشات والتقارير قابلة للتصدير إلى Excel و PDF، ويمكنك تنزيل نسخة كاملة من بياناتك متى شئت." },
  { q: "ماذا يحدث عند انتهاء الاشتراك؟", a: "تبقى بياناتك محفوظة كما هي ويمكنك تصديرها، وتعود للعمل فور التجديد دون فقد أي سجل." },
  { q: "هل يعمل على الجوال؟", a: "نعم، النظام يعمل من المتصفح على الجوال واللابتوب دون تثبيت أي تطبيق." },
];

export default function LandingPage() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <div className="lp-logo">🚛 <span>نظام النقل المحاسبي</span></div>
          <nav className="lp-links">
            <a href="#features">المميزات</a>
            <a href="#how">كيف يعمل</a>
            <a href="#pricing">الأسعار</a>
            <a href="#faq">الأسئلة الشائعة</a>
            <Link href="/complaints">الشكاوى</Link>
          </nav>
          <div className="lp-nav-cta">
            <ThemeToggle compact />
            <Link href="/login" className="btn">تسجيل الدخول</Link>
            <Link href="/register" className="btn btn-primary">ابدأ مجاناً</Link>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-container lp-hero-inner">
          <span className="lp-badge">✨ نسخة سحابية — تجربة مجانية ٧ أيام</span>
          <h1>
            أدر حسابات شركة النقل بالكامل
            <br />
            <span className="lp-grad">من شاشة واحدة</span>
          </h1>
          <p className="lp-sub">
            فواتير النقل، سندات القبض والدفع، الخزائن والبنوك، رواتب السائقين، وتقارير أرباح لحظية لكل
            رحلة وسيارة وعميل — بنظام عربي بالكامل مصمَّم خصيصاً لشركات النقل والنولون.
          </p>
          <div className="lp-hero-cta">
            <Link href="/register" className="btn btn-primary lp-btn-lg">ابدأ تجربتك المجانية</Link>
            <a href="#features" className="btn lp-btn-lg">شاهد المميزات</a>
          </div>
          <div className="lp-stats">
            <div><strong>٧ أيام</strong><span>تجربة مجانية</span></div>
            <div><strong>٥ دقائق</strong><span>حتى أول فاتورة</span></div>
            <div><strong>١٢+</strong><span>شاشة وتقرير</span></div>
            <div><strong>١٠٠٪</strong><span>عربي RTL</span></div>
          </div>
        </div>
      </section>

      <section id="features" className="lp-section">
        <div className="lp-container">
          <h2 className="lp-h2">كل ما تحتاجه شركة النقل — في نظام واحد</h2>
          <p className="lp-lead">بدل دفاتر متفرقة وملفات إكسل لا تنتهي، النظام يربط العملية بالقيد بالتقرير تلقائياً.</p>
          <div className="lp-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="lp-card">
                <div className="lp-card-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-h2">تبدأ خلال دقائق</h2>
          <p className="lp-lead">لا تثبيت، لا خوادم، لا فني صيانة — فقط سجّل وابدأ.</p>
          <div className="lp-steps">
            {STEPS.map((s) => (
              <div key={s.n} className="lp-step">
                <div className="lp-step-n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="pricing" className="lp-section">
        <div className="lp-container">
          <h2 className="lp-h2">أسعار واضحة بلا مفاجآت</h2>
          <p className="lp-lead">ابدأ مجاناً، وارتقِ حين يكبر عملك. يمكنك الإلغاء في أي وقت.</p>
          <div className="lp-plans">
            {PLANS.map((p) => (
              <div key={p.name} className={`lp-plan ${p.highlight ? "lp-plan-hl" : ""}`}>
                {p.highlight && <div className="lp-plan-tag">الأكثر اختياراً</div>}
                <h3>{p.name}</h3>
                <div className="lp-price"><strong>{p.price}</strong></div>
                <div className="lp-price-unit">{p.unit}</div>
                <ul>
                  {p.features.map((x) => (
                    <li key={x}>✔ {x}</li>
                  ))}
                </ul>
                <Link href="/register" className={`btn ${p.highlight ? "btn-primary" : ""} lp-plan-btn`}>{p.cta}</Link>
              </div>
            ))}
          </div>
          <p className="lp-note">الأسعار تقديرية وتُحدَّد نهائياً عند تفعيل الاشتراك مع فريق المبيعات.</p>
        </div>
      </section>

      <section id="faq" className="lp-section lp-section-alt">
        <div className="lp-container lp-faq">
          <h2 className="lp-h2">أسئلة شائعة</h2>
          {FAQ.map((f) => (
            <details key={f.q} className="lp-faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-container">
          <h2>جاهز تعرف ربح كل رحلة بالضبط؟</h2>
          <p>أنشئ حساب شركتك الآن وجرّب النظام كاملاً ٧ أيام بلا أي التزام.</p>
          <div className="lp-hero-cta">
            <Link href="/register" className="btn lp-btn-lg lp-btn-white">إنشاء حساب شركتي</Link>
            <Link href="/login" className="btn lp-btn-lg lp-btn-ghost">لدي حساب بالفعل</Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div>
            <div className="lp-logo">🚛 <span>نظام النقل المحاسبي</span></div>
            <p className="lp-footer-note">نظام محاسبي سحابي متخصص لشركات النقل والنولون.</p>
          </div>
          <div className="lp-footer-links">
            <a href="#features">المميزات</a>
            <a href="#pricing">الأسعار</a>
            <a href="#faq">الأسئلة الشائعة</a>
            <Link href="/login">تسجيل الدخول</Link>
            <Link href="/register">إنشاء حساب</Link>
            <Link href="/about">حول التطبيق</Link>
            <Link href="/complaints">الشكاوى والاقتراحات</Link>
          </div>
          <LandingDeveloperFooter />
        </div>
        <CopyrightLine className="lp-copy" />
      </footer>
    </div>
  );
}
