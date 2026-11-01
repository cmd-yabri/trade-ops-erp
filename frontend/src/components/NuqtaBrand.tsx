import { useId } from "react";
import { ArrowUpRight, Mail } from "lucide-react";
import { BRAND, brandWhatsappLink } from "@/lib/brand";
import { openExternal } from "@/lib/external";
import { cn } from "@/lib/utils";

/**
 * The nuqta mark: a diamond (the calligrapher's dot) with the letter noon cut out of it as a real mask,
 * so whatever is behind shows through. Same geometry as the studio site (20 unit grid).
 */
export function NuqtaMark({ className, color = BRAND.red }: { className?: string; color?: string }) {
  const id = `nq${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={cn("inline-block shrink-0", className)}>
      <defs>
        <mask id={id}>
          <rect width="200" height="200" fill="#fff" />
          <g fill="#000" transform="translate(0 10)">
            <path d="M71.7 71.7A40 40 0 1 0 128.3 71.7L117 83A24 24 0 1 1 83 83Z" />
            <polygon points="100,40 112,52 100,64 88,52" />
            <rect x="91.5" y="43.5" width="17" height="17" />
          </g>
        </mask>
      </defs>
      <polygon points="100,20 180,100 100,180 20,100" fill={color} mask={`url(#${id})`} />
    </svg>
  );
}

/** Wordmark: the mark, then `nuqta` (Geist 600, tight tracking) or «نقطة» (Readex Pro). */
export function NuqtaWordmark({
  lang = "en",
  className,
  onDark = false,
}: {
  lang?: "en" | "ar";
  className?: string;
  onDark?: boolean;
}) {
  return (
    <span
      dir="ltr"
      className={cn("inline-flex items-center gap-[0.04em] leading-none", className)}
      style={
        lang === "en"
          ? { fontFamily: "Geist, system-ui, sans-serif", fontWeight: 600, letterSpacing: "-0.04em" }
          : { fontFamily: "'Readex Pro', Cairo, sans-serif", fontWeight: 600 }
      }
    >
      <NuqtaMark className="-ms-[0.18em] h-[1.4em] w-[1.4em]" color={onDark ? BRAND.redOnDark : BRAND.red} />
      <span>{lang === "en" ? BRAND.nameEn : BRAND.nameAr}</span>
    </span>
  );
}

/** Slim credit at the bottom of the (dark) sidebar. */
export function NuqtaSidebarCredit({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn("flex items-center rounded-lg px-2 py-1.5 select-none", collapsed ? "justify-center" : "justify-start gap-2")}
      title="Nuqta Web Studio — نقطة ستوديو ويب"
    >
      {collapsed ? (
        <NuqtaMark className="h-5 w-5" color={BRAND.redOnDark} />
      ) : (
        <div className="leading-tight" dir="ltr">
          <p className="text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/40">Crafted by</p>
          <p className="flex items-center gap-2 text-sidebar-foreground/90">
            <NuqtaWordmark onDark className="text-[17px]" />
            <span className="text-[11px] font-medium tracking-tight text-sidebar-foreground/50">{BRAND.kindEn}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** Quiet one-liner under the login form. */
export function NuqtaLoginCredit() {
  return (
    <div className="mt-10 flex items-center justify-center gap-2 text-muted-foreground/80" dir="ltr">
      <span className="text-[10px] uppercase tracking-[0.2em]">A</span>
      <NuqtaWordmark className="text-[15px] text-foreground/80" />
      <span className="text-[11px] font-medium">{BRAND.kindEn} product</span>
    </div>
  );
}

/** The studio's ad for the Settings page: ink ground, big wordmark, one red diamond, a WhatsApp action. */
export function NuqtaBanner() {
  const [main] = BRAND.phones;
  return (
    <section
      className="relative overflow-hidden rounded-xl text-white"
      style={{ backgroundColor: BRAND.ink }}
      aria-label="Nuqta Web Studio"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: "radial-gradient(#fff 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        aria-hidden="true"
      />
      <div className="relative grid gap-6 p-6 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="space-y-3 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.24em] text-white/45" dir="ltr">
            TradeOps is a product of
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <NuqtaWordmark onDark className="text-[44px]" />
            <span className="text-white/35 text-xl" aria-hidden="true">/</span>
            <NuqtaWordmark lang="ar" onDark className="text-[34px]" />
            <span className="text-sm text-white/50 font-medium" dir="ltr">
              {BRAND.kindEn} · {BRAND.kindAr}
            </span>
          </div>
          <p className="text-sm text-white/70 max-w-xl leading-relaxed">{BRAND.descriptionAr}</p>
          <p className="text-xs text-white/40 max-w-xl leading-relaxed" dir="ltr">
            {BRAND.descriptionEn}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <button
            type="button"
            onClick={() => openExternal(brandWhatsappLink(main.wa))}
            className="group inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            style={{ backgroundColor: BRAND.red }}
          >
            تواصل معنا عبر واتساب
            <ArrowUpRight className="w-4 h-4 transition group-hover:-translate-y-0.5" />
          </button>
          <p className="flex items-center gap-1.5 text-[11px] text-white/45" dir="ltr">
            <Mail className="w-3 h-3" /> {BRAND.emails[0]}
          </p>
          <p className="text-[11px] text-white/35" dir="ltr">
            {BRAND.phones.map((p) => p.display).join("  ·  ")}
          </p>
        </div>
      </div>
    </section>
  );
}
