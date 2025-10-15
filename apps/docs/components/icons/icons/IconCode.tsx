// Generated from svgs/IconCode.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCode = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M9.403 1.266a.75.75 0 0 1 .581.887l-2.5 12a.75.75 0 1 1-1.468-.306l2.5-12a.75.75 0 0 1 .887-.581M4.8 4.24a.75.75 0 0 1-.04 1.06L1.852 8l2.908 2.7a.75.75 0 1 1-1.02 1.1L.24 8.55a.75.75 0 0 1 0-1.1l3.5-3.25a.75.75 0 0 1 1.06.04m6.4 0a.75.75 0 0 1 1.06-.04l3.5 3.25a.75.75 0 0 1 0 1.1l-3.5 3.25a.75.75 0 1 1-1.02-1.1L14.148 8 11.24 5.3a.75.75 0 0 1-.04-1.06" /></svg>
	);
};

export { IconCode as ReactComponent };
