'use client';

import { FileDiff } from '@/components/diff-ui/FileDiff';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { FileContents } from '@pierre/diff-ui';
import { CornerDownRight } from 'lucide-react';

import { FeatureHeader } from './FeatureHeader';

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
    <div className="space-y-5">
      <FeatureHeader
        title="Comments & Annotations"
        description="Precision Diffs provide a flexible annotation framework for injecting additional content and context into your diffs. Use it to render line comments, annotations from CI jobs, and other third party content."
      />
      <FileDiff
        oldFile={OLD_FILE}
        newFile={NEW_FILE}
        className="rounded-lg overflow-hidden border"
        options={{
          theme: 'pierre-dark',
          diffStyle: 'unified',
        }}
        annotations={[{ side: 'additions', lineNumber: 8 }]}
        renderAnnotation={() => <Thread />}
      />
    </div>
  );
}

function Thread() {
  return (
    <div
      className="max-w-[95%] sm:max-w-[70%]"
      style={{
        whiteSpace: 'normal',
        margin: 20,
        fontFamily: 'Geist',
      }}
    >
      <CommentThread
        mainComment={{
          author: 'You',
          timestamp: '3h',
          content:
            'Good lord, I refuse to look at diffs ever again after this.',
          avatarUrl:
            'https://db.heypierre.app/storage/v1/object/public/avatars/i8UHRtQf_400x400.jpg',
          isYou: true,
        }}
        replies={[
          {
            author: 'Amadeus',
            timestamp: '2h',
            content: 'Wait, how long have we been working on this?',
            avatarUrl:
              'https://db.heypierre.app/storage/v1/object/public/avatars/Evzotboe_400x400.jpg',
          },
          {
            author: 'Mark',
            timestamp: '2h',
            content: '*checks notes*… it’s not been a short amount of time.',
            avatarUrl:
              'https://db.heypierre.app/storage/v1/object/public/avatars/BET9cPgr_400x400.jpg',
          },
        ]}
        onAddReply={() => console.log('Add reply clicked')}
        onResolve={() => console.log('Resolve clicked')}
      />
    </div>
  );
}

interface CommentProps {
  author: string;
  timestamp: string;
  content: string;
  avatarUrl?: string;
  isYou?: boolean;
}

export function Comment({
  author,
  timestamp,
  content,
  avatarUrl,
  isYou = false,
}: CommentProps) {
  return (
    <div className="flex gap-2">
      <div className="relative flex-shrink-0 -mt-0.5">
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl ?? '/placeholder.svg'} alt={author} />
          <AvatarFallback>{author[0]}</AvatarFallback>
        </Avatar>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-foreground">
            {isYou ? 'You' : author}
          </span>
          <span className="text-sm text-muted-foreground">{timestamp}</span>
        </div>
        <p className="text-foreground leading-relaxed">{content}</p>
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
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <Comment {...mainComment} />

      {replies.length > 0 && (
        <div className="mt-4 ml-8 sm:ml-[32px] space-y-4">
          {replies.map((reply, index) => (
            <Comment key={index} {...reply} />
          ))}
        </div>
      )}

      <div className="mt-4 ml-8 sm:ml-[32px] flex items-center gap-4">
        <button
          onClick={onAddReply}
          className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          <CornerDownRight className="h-4 w-4" />
          Add reply...
        </button>
        <button
          onClick={onResolve}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Resolve
        </button>
      </div>
    </div>
  );
}
