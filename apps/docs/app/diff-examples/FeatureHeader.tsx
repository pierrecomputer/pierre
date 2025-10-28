interface FeatureHeaderProps {
  title: string;
  description: string;
}

export function FeatureHeader({ title, description }: FeatureHeaderProps) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-medium">{title}</h2>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
  );
}
