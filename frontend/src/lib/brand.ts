/**
 * Nuqta Web Studio (نقطة ستوديو ويب), the studio behind TradeOps.
 * Texts and contacts are copied from the studio's own site config (portfolio_website/lib/site.ts).
 * Edit here; they appear in the sidebar, on the login page and in Settings.
 */
export const BRAND = {
  nameEn: "nuqta",
  nameAr: "نقطة",
  kindEn: "Web Studio",
  kindAr: "ستوديو ويب",
  descriptionEn:
    "Nuqta is a two-person web studio building storefronts, booking sites, ERP systems, brand identities and mobile apps.",
  descriptionAr: "نقطة ستوديو ويب من شخصين يبني المتاجر ومواقع الحجز وأنظمة ERP والهويات البصرية وتطبيقات الجوال.",
  emails: ["ferasaljabry@gmail.com", "guyth.daba@gmail.com"],
  phones: [
    { display: "+963 992 575 158", wa: "963992575158" },
    { display: "+963 945 294 464", wa: "963945294464" },
  ],
  /** Signal red of the identity (lighter on dark grounds) */
  red: "#e2321a",
  redOnDark: "#ff6a4d",
  ink: "#0c0c0d",
};

export const brandWhatsappLink = (wa: string) =>
  `https://wa.me/${wa}?text=${encodeURIComponent("مرحباً نقطة، أستخدم تريد أوبس وأود الاستفسار عن خدماتكم.")}`;
