import { useEffect, useMemo, useState } from "react";
import type { ProductCardConfig } from "../../models/filterConfig.shared";

type Props = {
  productCard: ProductCardConfig;
  customCss?: string;
};

/** Preview photos from /public/assets/testimage — used for single & slideshow demos. */
const PREVIEW_IMAGES = [
  "/assets/testimage/test_preview_1.png",
  "/assets/testimage/test_preview_2.png",
  "/assets/testimage/test_preview_3.png",
] as const;

function ratioVar(ratio: ProductCardConfig["imageRatio"]): string {
  if (ratio === "portrait") return "3 / 4";
  if (ratio === "square") return "1 / 1";
  return "auto";
}

export function ProductCardPreview({ productCard, customCss = "" }: Props) {
  const [slideIndex, setSlideIndex] = useState(0);
  const [hovering, setHovering] = useState(false);
  const layout = productCard.cardLayout || "classic";

  const maxImages = Math.min(
    productCard.slideshowMaxImages || PREVIEW_IMAGES.length,
    PREVIEW_IMAGES.length,
  );
  const slides = PREVIEW_IMAGES.slice(0, Math.max(2, maxImages));

  useEffect(() => {
    setSlideIndex(0);
    setHovering(false);
  }, [productCard.imageSlideshow, productCard.slideshowMaxImages]);

  useEffect(() => {
    if (
      !productCard.imageSlideshow ||
      productCard.slideshowMode !== "hover" ||
      !hovering
    ) {
      return;
    }
    const ms = Math.max(0.4, productCard.slideshowSpeed) * 1000;
    const id = window.setInterval(() => {
      setSlideIndex((i) => (i + 1) % slides.length);
    }, ms);
    return () => window.clearInterval(id);
  }, [
    productCard.imageSlideshow,
    productCard.slideshowMode,
    productCard.slideshowSpeed,
    slides.length,
    hovering,
  ]);

  const gridClass = useMemo(() => {
    const parts = [
      "aco-pf-grid",
      "aco-pf-preview-grid",
      `aco-pf-grid--layout-${layout}`,
    ];
    parts.push(`aco-pf-grid--ratio-${productCard.imageRatio}`);
    if (productCard.hoverZoom) parts.push("aco-pf-grid--zoom");
    if (productCard.cardBorder) parts.push("aco-pf-grid--card");
    if (productCard.textAlign === "center") parts.push("aco-pf-grid--center");
    if (productCard.imageSlideshow && productCard.slideshowMode === "arrows") {
      parts.push("aco-pf-grid--ss-arrows");
      if (productCard.slideshowArrowsAlways) {
        parts.push("aco-pf-grid--ss-arrows-always");
      }
    }
    if (productCard.showAddToCart || productCard.showBuyNow) {
      parts.push("aco-pf-grid--has-actions");
    }
    return parts.join(" ");
  }, [productCard, layout]);

  const btnClass =
    productCard.buttonStyle === "outline"
      ? "aco-pf-card__btn aco-pf-card__btn--atc aco-pf-card__btn--outline"
      : "aco-pf-card__btn aco-pf-card__btn--atc";

  const buyClass =
    productCard.buttonStyle === "outline"
      ? "aco-pf-card__btn aco-pf-card__btn--buy aco-pf-card__btn--outline"
      : "aco-pf-card__btn aco-pf-card__btn--buy";

  const btnStyle = {
    "--aco-pf-btn-bg": productCard.buttonColor,
    "--aco-pf-btn-fg":
      productCard.buttonStyle === "outline"
        ? productCard.buttonColor
        : productCard.buttonTextColor,
    "--aco-pf-btn-radius": `${productCard.buttonRadius}px`,
  } as React.CSSProperties;

  const rootStyle = {
    "--aco-pf-card-ratio": ratioVar(productCard.imageRatio),
    "--aco-pf-card-fit": productCard.imageFit,
    "--aco-pf-card-title-size": `${productCard.titleSize}px`,
    "--aco-pf-card-title-weight": String(productCard.titleWeight || 400),
    "--aco-pf-card-price-size": `${productCard.priceSize || 14}px`,
    "--aco-pf-card-radius": `${productCard.cardRadius ?? 8}px`,
    "--aco-pf-card-media-radius": `${Math.max(0, (productCard.cardRadius ?? 8) - (productCard.cardBorder ? 2 : 0))}px`,
    "--aco-pf-card-bg": productCard.cardBackground || "#ffffff",
    "--aco-pf-card-fg": productCard.cardTextColor || "#111111",
    "--aco-pf-card-border": productCard.cardBorderColor || "#e5e5e5",
    "--aco-pf-card-shadow":
      productCard.cardShadow === "medium"
        ? "0 6px 18px rgba(0,0,0,0.14)"
        : productCard.cardShadow === "soft"
          ? "0 2px 8px rgba(0,0,0,0.08)"
          : "none",
    "--aco-pf-sale-badge-bg": productCard.saleBadgeColor,
    "--aco-pf-sale-badge-fg": productCard.saleBadgeTextColor,
    "--aco-pf-soldout-badge-bg": productCard.soldOutBadgeColor,
    "--aco-pf-soldout-badge-fg": productCard.soldOutBadgeTextColor,
  } as React.CSSProperties;

  const showActions = productCard.showAddToCart || productCard.showBuyNow;

  const stepSlide = (delta: number) => {
    setSlideIndex((i) => (i + delta + slides.length) % slides.length);
  };

  const flagPos = productCard.badgePosition || "top-left";
  const flagSize = productCard.badgeSize || "medium";
  const flagBase = `aco-pf-card__flag aco-pf-card__flag--${flagPos} aco-pf-card__flag--${flagSize}`;
  let flag: React.ReactNode = null;
  if (productCard.showSaleBadge) {
    flag = (
      <span className={`${flagBase} aco-pf-card__badge aco-pf-card__badge--sale`}>
        {productCard.saleBadgeText || "Sale"}
      </span>
    );
  } else if (productCard.showSoldOutBadge) {
    flag = (
      <span className={`${flagBase} aco-pf-card__soldout`}>
        {productCard.soldOutBadgeText || "Out of stock"}
      </span>
    );
  }

  const priceBlock = (
    <span className="aco-pf-card__price">
      $29.00
      {productCard.showComparePrice && (
        <s className="aco-pf-card__was">$39.00</s>
      )}
      {productCard.showDiscountBadge && (
        <span
          className={`aco-pf-card__badge aco-pf-card__badge--${productCard.discountBadgeStyle}`}
        >
          {productCard.discountBadgeText || "Save"} 26%
        </span>
      )}
    </span>
  );

  const media = productCard.imageSlideshow ? (
    <div
      className="aco-pf-card__media aco-pf-card__media--gallery"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => {
        setHovering(false);
        setSlideIndex(0);
      }}
    >
      <div className="aco-pf-card__slides">
        {slides.map((src, i) => (
          <img
            key={src}
            className={`aco-pf-card__img aco-pf-card__slide${
              i === slideIndex ? " is-active" : ""
            }`}
            src={src}
            alt=""
          />
        ))}
      </div>
      {productCard.slideshowMode === "arrows" && (
        <>
          <button
            type="button"
            className="aco-pf-card__nav aco-pf-card__nav--prev"
            aria-label="Previous image"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              stepSlide(-1);
            }}
          >
            &lsaquo;
          </button>
          <button
            type="button"
            className="aco-pf-card__nav aco-pf-card__nav--next"
            aria-label="Next image"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              stepSlide(1);
            }}
          >
            &rsaquo;
          </button>
        </>
      )}
      {productCard.slideshowDots && (
        <div className="aco-pf-card__dots">
          {slides.map((src, i) => (
            <span
              key={src}
              className={`aco-pf-card__dot${
                i === slideIndex ? " is-active" : ""
              }`}
            />
          ))}
        </div>
      )}
      {flag}
    </div>
  ) : (
    <div className="aco-pf-card__media">
      <img className="aco-pf-card__img" src={PREVIEW_IMAGES[0]} alt="" />
      {flag}
    </div>
  );

  const swatches = (
    <div className="aco-pf-card__swatches" aria-hidden>
      <span className="aco-pf-card__swatch is-active" style={{ background: "#111" }} />
      <span className="aco-pf-card__swatch" style={{ background: "#fff" }} />
      <span className="aco-pf-card__swatch" style={{ background: "#2563eb" }} />
      <span className="aco-pf-card__swatch-more">+2</span>
    </div>
  );

  return (
    <div className="aco-pf-preview-root" style={rootStyle}>
      {customCss.trim() ? (
        // Raw text, not a React text child: server rendering escapes `>`, `&`
        // and quotes as entities, which <style> doesn't decode, so the CSS
        // differs from the client's, hydration fails and the whole document is
        // re-rendered (an unstyled flash). `</style` is neutralised so merchant
        // CSS can't end the tag early.
        <style
          dangerouslySetInnerHTML={{
            __html: customCss.replace(/<\/(style)/gi, "<\\/$1"),
          }}
        />
      ) : null}
      <div className="aco-pf-preview-frame">
        <ul className={gridClass}>
          <li className="aco-pf-card">
            <a
              className="aco-pf-card__link"
              href="#preview"
              onClick={(e) => e.preventDefault()}
            >
              {media}
              <div className="aco-pf-card__info">
                {productCard.showVendor && (
                  <span className="aco-pf-card__vendor">Demo Brand</span>
                )}
                <span className="aco-pf-card__title">Sample Product</span>
                {priceBlock}
                {layout === "split" ? swatches : null}
              </div>
            </a>
            {showActions && (
              <div className="aco-pf-card__actions">
                {productCard.showAddToCart && (
                  <button type="button" className={btnClass} style={btnStyle}>
                    {productCard.addToCartText || "Add to cart"}
                  </button>
                )}
                {productCard.showBuyNow && (
                  <button type="button" className={buyClass} style={btnStyle}>
                    {productCard.buyNowText || "Buy it now"}
                  </button>
                )}
              </div>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}
