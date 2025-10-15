// Generated from svgs/IconCopy.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCopy = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M4 2.25A2.25 2.25 0 0 1 6.25 0h7.5A2.25 2.25 0 0 1 16 2.25v7.5A2.25 2.25 0 0 1 13.75 12h-7.5A2.25 2.25 0 0 1 4 9.75zm2.25-.75a.75.75 0 0 0-.75.75v7.5c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75v-7.5a.75.75 0 0 0-.75-.75zm-4 4a.75.75 0 0 0-.75.75v7.5c0 .414.336.75.75.75h7.5a.75.75 0 0 0 .75-.75V13H12v.75A2.25 2.25 0 0 1 9.75 16h-7.5A2.25 2.25 0 0 1 0 13.75v-7.5A2.25 2.25 0 0 1 2.25 4h.625v1.5z" /></svg>
	);
};

export { IconCopy as ReactComponent };
