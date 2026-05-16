type PageHeaderProps = {
  kicker: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function PageHeader({kicker, title, description, action}: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        <p className="section-kicker">{kicker}</p>
        <h2 className="page-title">{title}</h2>
        {description ? <p className="muted-copy mt-3 max-w-2xl">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
