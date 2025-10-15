// Generated from svgs/IconBulbFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconBulbFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4.11 1.61a5.5 5.5 0 0 1 7.815 7.743l-.006.006-.029.03C11.777 9.516 11 10.45 11 12H5c0-1.55-.778-2.484-.89-2.611l-.029-.03-.005-.005A5.5 5.5 0 0 1 4.11 1.61M5 13a3 3 0 1 0 6 0z" /></svg>
	);
};

export { IconBulbFill as ReactComponent };
