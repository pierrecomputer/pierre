// Generated from svgs/IconChevronsClose.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconChevronsClose = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.47 6.53a.75.75 0 0 0 1.06 0l3.25-3.25a.75.75 0 0 0-1.06-1.06L8 4.94 5.28 2.22a.75.75 0 0 0-1.06 1.06zm-3.25 7.25a.75.75 0 0 0 1.06 0L8 11.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L8.53 9.47a.75.75 0 0 0-1.06 0l-3.25 3.25a.75.75 0 0 0 0 1.06" /></svg>
	);
};

export { IconChevronsClose as ReactComponent };
