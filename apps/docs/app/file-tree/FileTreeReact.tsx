'use client';

import { createComponent } from '@lit/react';
import { FileTree } from '@pierre/file-tree';
import React from 'react';

export const FileTreeReact = createComponent({
  tagName: 'file-tree',
  elementClass: FileTree,
  react: React,
});
