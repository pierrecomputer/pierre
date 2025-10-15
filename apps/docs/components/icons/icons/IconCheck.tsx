// Generated from svgs/IconCheck.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCheck = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M13.855 3.174a.75.75 0 0 1 .096 1.056l-7.083 8.5a.75.75 0 0 1-1.107.05L2.22 9.24a.75.75 0 0 1 1.06-1.061l2.961 2.96L12.8 3.27a.75.75 0 0 1 1.056-.096" /></svg>
	);
};

export { IconCheck as ReactComponent };
