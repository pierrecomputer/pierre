// Generated from svgs/IconAlignCenter.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconAlignCenter = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 0a.75.75 0 0 1 .75.75V2h4.75A1.5 1.5 0 0 1 15 3.5v2A1.5 1.5 0 0 1 13.5 7H8.75v2h2.75a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H8.75v1.25a.75.75 0 0 1-1.5 0V14H4.5A1.5 1.5 0 0 1 3 12.5v-2A1.5 1.5 0 0 1 4.5 9h2.75V7H2.5A1.5 1.5 0 0 1 1 5.5v-2A1.5 1.5 0 0 1 2.5 2h4.75V.75A.75.75 0 0 1 8 0" /></svg>
	);
};

export { IconAlignCenter as ReactComponent };
