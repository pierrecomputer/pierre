'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { IconAnnotate, IconComment } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { FileContents } from '@pierre/diff-ui';
import { CornerDownRight } from 'lucide-react';

const OLD_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'file.tsx',
  contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
};

export function Annotations() {
  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold">Comments & Annotations</h3>
      <p className="text-sm text-muted-foreground">
        Precision Diffs provides a flexible annotation framework for injecting
        additional content and context into your diffs. Use it to render line
        comments, annotations from CI jobs, and other third party content.
      </p>

      <div></div>

      {/* <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        options={{
          detectLanguage: true,
          theme: 'catppuccin-frappe',
        }}
      /> */}
    </div>
  );
}

interface CommentProps {
  author: string;
  timestamp: string;
  content: string;
  avatarUrl?: string;
  avatarBadge?: string;
  isYou?: boolean;
}

export function Comment({
  author,
  timestamp,
  content,
  avatarUrl,
  avatarBadge,
  isYou = false,
}: CommentProps) {
  return (
    <div className="flex gap-3">
      <div className="relative flex-shrink-0">
        <Avatar className="h-10 w-10">
          <AvatarImage src={avatarUrl || '/placeholder.svg'} alt={author} />
          <AvatarFallback>{author[0]}</AvatarFallback>
        </Avatar>
        {avatarBadge && (
          <Avatar className="absolute -bottom-1 -right-1 h-5 w-5 border-2 border-white">
            <AvatarImage src={avatarBadge || '/placeholder.svg'} alt="" />
            <AvatarFallback className="text-[8px]">+</AvatarFallback>
          </Avatar>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-foreground">
            {isYou ? 'You' : author}
          </span>
          <span className="text-sm text-muted-foreground">{timestamp}</span>
        </div>
        <p className="mt-1 text-foreground leading-relaxed">{content}</p>
      </div>
    </div>
  );
}

interface CommentThreadProps {
  mainComment: CommentProps;
  replies?: CommentProps[];
  onAddReply?: () => void;
  onResolve?: () => void;
}

export function CommentThread({
  mainComment,
  replies = [],
  onAddReply,
  onResolve,
}: CommentThreadProps) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <Comment {...mainComment} />

      {replies.length > 0 && (
        <div className="mt-4 ml-[52px] space-y-4">
          {replies.map((reply, index) => (
            <Comment key={index} {...reply} />
          ))}
        </div>
      )}

      <div className="mt-4 ml-[52px] flex items-center gap-4">
        <button
          onClick={onAddReply}
          className="flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          <CornerDownRight className="h-4 w-4" />
          Add reply...
        </button>
        <button
          onClick={onResolve}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
        >
          Resolve
        </button>
      </div>
    </div>
  );
}
