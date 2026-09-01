// حدود الرفع الوحيدة المسموح بها في المشروع (صورة وصل تُمرَّر لتليجرام فقط).
// لا يوجد أي رفع ملفات آخر للعميل أو الزائر على مستوى الموقع.
export const MAX_UPLOAD_MB = 3;
export const ALLOWED_UPLOAD_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
