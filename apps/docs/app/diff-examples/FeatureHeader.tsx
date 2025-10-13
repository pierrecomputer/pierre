interface FeatureHeaderProps {
  title: string;
  description: string;
}

export function FeatureHeader({ title, description }: FeatureHeaderProps) {
  return (
    <div className="max-w-2xl">
      <h3 className="text-xl font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
