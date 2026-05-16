type PageHeaderProps = {
  kicker: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function PageHeader({kicker, title, description, action}: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5">
      <div className="max-w-4xl">
        <p className="section-kicker">{kicker}</p>
        <h2 className="page-title">{title}</h2>
        {description ? <p className="muted-copy mt-4 max-w-3xl">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
