// Generated from svgs/IconInboxUnread.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconInboxUnread = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M13.5 5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" /><path d="M4.142 1h6.195A3.5 3.5 0 0 0 10 2.5H4.142a.25.25 0 0 0-.228.146L1.92 7H4c1.002 0 1.638.808 1.873 1.487q.057.165.139.318a2.25 2.25 0 0 0 4.115-.318C10.362 7.807 10.997 7 12 7h2.081l-.46-1.002a3.5 3.5 0 0 0 1.476-.383l.828 1.808A.75.75 0 0 1 16 7.73v3.52A2.75 2.75 0 0 1 13.25 14H2.75A2.75 2.75 0 0 1 0 11.25v-3.5q.002-.177.075-.327L2.55 2.02A1.75 1.75 0 0 1 4.14 1" /></svg>
	);
};

export { IconInboxUnread as ReactComponent };
