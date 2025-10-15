// Generated from svgs/IconEnvelopeFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconEnvelopeFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M15.976 4.388q.024.178.024.362v6.5A2.75 2.75 0 0 1 13.25 14H2.75A2.75 2.75 0 0 1 0 11.25v-6.5q0-.185.024-.362A2.75 2.75 0 0 1 2.75 2h10.5a2.75 2.75 0 0 1 2.726 2.388M1.5 6.622V4.999L8 7.689l6.5-2.69v1.623L8 9.312z" clipRule="evenodd" /></svg>
	);
};

export { IconEnvelopeFill as ReactComponent };
