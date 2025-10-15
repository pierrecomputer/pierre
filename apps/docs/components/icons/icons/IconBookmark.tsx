// Generated from svgs/IconBookmark.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconBookmark = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2 2.75A2.75 2.75 0 0 1 4.75 0h6.5A2.75 2.75 0 0 1 14 2.75v12.5a.75.75 0 0 1-1.122.651L8 13.114 3.122 15.9A.75.75 0 0 1 2 15.25zM4.75 1.5c-.69 0-1.25.56-1.25 1.25v11.208l4.128-2.36a.75.75 0 0 1 .744 0l4.128 2.36V2.75c0-.69-.56-1.25-1.25-1.25z" /></svg>
	);
};

export { IconBookmark as ReactComponent };
