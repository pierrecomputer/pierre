// Generated from svgs/IconInbox.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconInbox = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M15.925 7.423 13.45 2.021A1.75 1.75 0 0 0 11.86 1H4.141A1.75 1.75 0 0 0 2.55 2.02L.075 7.424A.75.75 0 0 0 0 7.75v3.5A2.75 2.75 0 0 0 2.75 14h10.5A2.75 2.75 0 0 0 16 11.25V7.73a.75.75 0 0 0-.075-.307M4.142 2.5h7.716a.25.25 0 0 1 .228.146L14.08 7H12c-1.002 0-1.638.808-1.873 1.487a2.251 2.251 0 0 1-4.254 0C5.638 7.807 5.003 7 4 7H1.919l1.995-4.354a.25.25 0 0 1 .228-.146" /></svg>
	);
};

export { IconInbox as ReactComponent };
