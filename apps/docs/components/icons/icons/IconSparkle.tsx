// Generated from svgs/IconSparkle.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconSparkle = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M10.353 5.647c1.476 1.476 4.11 1.795 5.178 1.863.259.017.469.23.469.49s-.21.473-.47.49c-1.068.068-3.701.387-5.177 1.863s-1.795 4.11-1.863 5.178A.5.5 0 0 1 8 16a.5.5 0 0 1-.49-.47c-.068-1.068-.387-3.701-1.863-5.177S1.537 8.558.47 8.49A.5.5 0 0 1 0 8c0-.26.21-.473.47-.49 1.068-.068 3.701-.387 5.177-1.863S7.442 1.537 7.51.47C7.527.21 7.74 0 8 0s.473.21.49.47c.068 1.068.387 3.701 1.863 5.177" /></svg>
	);
};

export { IconSparkle as ReactComponent };
