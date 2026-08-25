import {
  CARD_LAYOUT_META,
  CARD_LAYOUTS,
  type CardLayout,
} from "../../models/filterConfig.shared";

type Props = {
  value: CardLayout;
  onSelect: (layout: CardLayout) => void;
};

/** Mini structural sketches — layout shape, not appearance presets. */
function LayoutThumb({ layout }: { layout: CardLayout }) {
  if (layout === "split") {
    return (
      <div className="aco-pf-layout-thumb aco-pf-layout-thumb--split" aria-hidden>
        <div className="aco-pf-layout-thumb__media" />
        <div className="aco-pf-layout-thumb__body">
          <span />
          <span />
          <span className="aco-pf-layout-thumb__btn" />
        </div>
      </div>
    );
  }
  return (
    <div className="aco-pf-layout-thumb aco-pf-layout-thumb--classic" aria-hidden>
      <div className="aco-pf-layout-thumb__media" />
      <div className="aco-pf-layout-thumb__body">
        <span />
        <span />
      </div>
    </div>
  );
}

export function CardLayoutPicker({ value, onSelect }: Props) {
  return (
    <div className="aco-pf-layout-picker">
      <p className="aco-pf-layout-picker__label">Card layout</p>
      <p className="aco-pf-layout-picker__hint">
        Pick a structure for every product card. Fine-tune colors and type below.
      </p>
      <div className="aco-pf-layout-picker__grid" role="listbox" aria-label="Card layout">
        {CARD_LAYOUTS.map((id) => {
          const meta = CARD_LAYOUT_META[id];
          const selected = value === id;
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={selected}
              className={
                selected
                  ? "aco-pf-layout-picker__option is-selected"
                  : "aco-pf-layout-picker__option"
              }
              onClick={() => onSelect(id)}
            >
              <LayoutThumb layout={id} />
              <span className="aco-pf-layout-picker__name">{meta.label}</span>
              <span className="aco-pf-layout-picker__desc">{meta.description}</span>
            </button>
          );
        })}
      </div>
      <style>{`
        .aco-pf-layout-picker__label {
          margin: 0 0 0.15rem;
          font-size: 0.8125rem;
          font-weight: 650;
          color: #202223;
        }
        .aco-pf-layout-picker__hint {
          margin: 0 0 0.75rem;
          font-size: 0.75rem;
          color: #6d7175;
        }
        .aco-pf-layout-picker__grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.65rem;
          max-width: 420px;
        }
        @media (max-width: 720px) {
          .aco-pf-layout-picker__grid { grid-template-columns: 1fr; max-width: none; }
        }
        .aco-pf-layout-picker__option {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.55rem;
          border: 1.5px solid #dfe3e8;
          border-radius: 10px;
          background: #fff;
          cursor: pointer;
          text-align: left;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .aco-pf-layout-picker__option:hover { border-color: #8c9196; }
        .aco-pf-layout-picker__option.is-selected {
          border-color: #111;
          box-shadow: 0 0 0 1px #111;
        }
        .aco-pf-layout-picker__name {
          font-size: 0.8125rem;
          font-weight: 650;
          color: #202223;
        }
        .aco-pf-layout-picker__desc {
          font-size: 0.7rem;
          line-height: 1.3;
          color: #6d7175;
        }
        .aco-pf-layout-thumb {
          height: 72px;
          border-radius: 8px;
          background: #f6f6f7;
          border: 1px solid #e4e5e7;
          overflow: hidden;
          padding: 6px;
          box-sizing: border-box;
        }
        .aco-pf-layout-thumb__media {
          background: #c9ccd1;
          border-radius: 4px;
        }
        .aco-pf-layout-thumb__body span {
          display: block;
          height: 5px;
          border-radius: 2px;
          background: #8c9196;
        }
        .aco-pf-layout-thumb__body span:nth-child(2) {
          width: 55%;
          background: #b5b9bd;
        }
        .aco-pf-layout-thumb__btn {
          height: 8px !important;
          background: #202223 !important;
          border-radius: 3px !important;
          margin-top: auto;
        }
        .aco-pf-layout-thumb--classic {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .aco-pf-layout-thumb--classic .aco-pf-layout-thumb__media {
          flex: 1;
        }
        .aco-pf-layout-thumb--classic .aco-pf-layout-thumb__body {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .aco-pf-layout-thumb--split {
          display: flex;
          gap: 6px;
        }
        .aco-pf-layout-thumb--split .aco-pf-layout-thumb__media {
          width: 42%;
          height: 100%;
        }
        .aco-pf-layout-thumb--split .aco-pf-layout-thumb__body {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
      `}</style>
    </div>
  );
}
