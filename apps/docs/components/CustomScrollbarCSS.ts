// NOTE(amadeus): Basically this makes sure the scroll bars don't get clipped
// by our rounded corners
export const CustomScrollbarCSS = `[data-type="split"] [data-code][data-additions]::-webkit-scrollbar-track {
		margin-right: 6px
}
[data-type="split"] [data-code][data-deletions]::-webkit-scrollbar-track {
		margin-left: 6px
}
[data-type="file"] [data-code]::-webkit-scrollbar-track {
  margin-inline: 6px;
}`;
