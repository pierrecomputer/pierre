// Generated from svgs/IconCommit.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCommit = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M3.056 8.748 3 8.75H.75a.75.75 0 0 1 0-1.5H3q.028 0 .056.002a5.001 5.001 0 0 1 9.888 0L13 7.25h2.25a.75.75 0 0 1 0 1.5H13q-.028 0-.056-.002a5.001 5.001 0 0 1-9.888 0M4.5 8a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0" /></svg>
	);
};

export { IconCommit as ReactComponent };
