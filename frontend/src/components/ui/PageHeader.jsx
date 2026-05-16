import React from 'react';

/**
 * Canonical page-header primitive.
 *
 * <PageHeader
 *   title="Invoices"
 *   subtitle="Manage and review all guardian invoices."
 *   actions={<Button>...</Button>}
 * />
 *
 * Layout: title block on the left, actions on the right.
 * Wraps cleanly on small screens (actions move below).
 * Uses shared spacing tokens consistent with the rest of the dashboard.
 */
const PageHeader = ({
  title,
  subtitle,
  actions,
  icon: Icon,
  className = '',
  titleClassName = '',
  subtitleClassName = '',
}) => {
  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between ${className}`.trim()}>
      <div className="min-w-0 flex items-start gap-3">
        {Icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0">
          {typeof title === 'string' ? (
            <h1 className={`text-lg sm:text-xl font-semibold text-foreground truncate ${titleClassName}`.trim()}>
              {title}
            </h1>
          ) : (
            title
          )}
          {subtitle ? (
            typeof subtitle === 'string' ? (
              <p className={`mt-0.5 text-sm text-muted-foreground ${subtitleClassName}`.trim()}>
                {subtitle}
              </p>
            ) : (
              subtitle
            )
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          {actions}
        </div>
      ) : null}
    </div>
  );
};

export default PageHeader;
