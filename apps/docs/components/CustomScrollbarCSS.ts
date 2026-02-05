// NOTE(amadeus): Basically this makes sure the scroll bars don't get clipped
// by our rounded corners
export const CustomScrollbarCSS = `[data-diff-type="split"] [data-code][data-additions]::-webkit-scrollbar-track {
		margin-right: 6px
}
[data-diff-type="split"] [data-code][data-deletions]::-webkit-scrollbar-track {
		margin-left: 6px
}
[data-file] [data-code]::-webkit-scrollbar-track,
[data-diff-type="single"] [data-code]::-webkit-scrollbar-track {
  margin-inline: 6px;
}`;
