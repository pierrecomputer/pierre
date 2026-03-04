import { SWATCH_TOKENS } from './constants';

export function Swatches({ styles }: { styles: Record<string, string> }) {
  return (
    <div className="grid grid-cols-2 gap-px">
      {SWATCH_TOKENS.map(({ key, label }) => {
        const value = styles[key];
        const missing = value == null || value === '';
        return (
          <div key={key} className="flex items-center gap-2">
            <div
              className="h-6 w-6 flex-shrink-0 rounded shadow-[inset_0_0_0_1px_rgb(0_0_0_/_0.1)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.1)]"
              style={
                missing
                  ? {
                      background:
                        'repeating-conic-gradient(#d4d4d4 0% 25%, transparent 0% 50%) 0 0 / 8px 8px',
                    }
                  : { backgroundColor: value }
              }
            />
            <span
              className={`truncate text-[10px] leading-tight ${missing ? 'font-medium text-red-500' : 'text-neutral-500 dark:text-neutral-400'}`}
              title={missing ? `${key}: (missing)` : `${key}: ${value}`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
