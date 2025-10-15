// Generated from svgs/IconCheckLg.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCheckLg = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M14.605 3.174a.75.75 0 0 1 .096 1.056l-8.083 9.5a.75.75 0 0 1-1.107.05L.97 9.24a.75.75 0 0 1 1.06-1.061l3.961 3.96L13.55 3.27a.75.75 0 0 1 1.056-.096" /></svg>
	);
};

export { IconCheckLg as ReactComponent };
