// Generated from svgs/IconLayers2.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconLayers2 = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.553.224.894 3.553a.5.5 0 0 0 0 .894l6.659 3.33a1 1 0 0 0 .894 0l6.659-3.33a.5.5 0 0 0 0-.894L8.447.223a1 1 0 0 0-.894 0" /><path d="m2.882 6.559-1.988.994a.5.5 0 0 0 0 .894l6.659 3.33a1 1 0 0 0 .894 0l6.659-3.33a.5.5 0 0 0 0-.894l-1.988-.994-1.677.839L12.646 8 8 10.323 3.354 8l1.205-.602z" /><path d="m2.882 10.559 1.677.839L3.354 12 8 14.323 12.646 12l-1.205-.602 1.677-.839 1.988.994a.5.5 0 0 1 0 .894l-6.659 3.33a1 1 0 0 1-.894 0l-6.659-3.33a.5.5 0 0 1 0-.894z" /></svg>
	);
};

export { IconLayers2 as ReactComponent };
