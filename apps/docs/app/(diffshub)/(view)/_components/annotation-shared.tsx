// Shared pieces used by both DraftAnnotation and ExampleAnnotation.

// Base Tailwind classes for the annotation card shell. Each annotation
// component composes this with its own extras via cn().
export const annotationCardBase =
  'bg-card m-2 flex max-w-[600px] gap-2.5 rounded-xl border border-[rgb(0_0_0_/_0.1)] bg-clip-padding p-3 font-sans shadow-[0_2px_4px_rgb(0_0_0_/_0.05),0_4px_8px_rgb(0_0_0_/_0.075)]';

interface CommentAuthorAvatarProps {
  author: string;
}

// Renders a small circular avatar showing the first letter of the author's name.
export function CommentAuthorAvatar({ author }: CommentAuthorAvatarProps) {
  return (
    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-lg font-medium text-purple-500">
      {author.charAt(0).toUpperCase()}
    </div>
  );
}
