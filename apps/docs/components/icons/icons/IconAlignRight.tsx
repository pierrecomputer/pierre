// Generated from svgs/IconAlignRight.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconAlignRight = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M15.25 0a.75.75 0 0 1 .75.75v14.5a.75.75 0 0 1-1.5 0V.75a.75.75 0 0 1 .75-.75M0 3.5A1.5 1.5 0 0 1 1.5 2h10A1.5 1.5 0 0 1 13 3.5v2A1.5 1.5 0 0 1 11.5 7h-10A1.5 1.5 0 0 1 0 5.5zM6.5 9A1.5 1.5 0 0 0 5 10.5v2A1.5 1.5 0 0 0 6.5 14h5a1.5 1.5 0 0 0 1.5-1.5v-2A1.5 1.5 0 0 0 11.5 9z" /></svg>
	);
};

export { IconAlignRight as ReactComponent };
