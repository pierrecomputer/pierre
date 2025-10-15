// Generated from svgs/IconApp.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconApp = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M3 4.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1M5 4a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0M6 4.5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1" /><path fillRule="evenodd" d="M2.25 1A2.25 2.25 0 0 0 0 3.25v9.5A2.25 2.25 0 0 0 2.25 15h11.5A2.25 2.25 0 0 0 16 12.75v-9.5A2.25 2.25 0 0 0 13.75 1zM1.5 3.25a.75.75 0 0 1 .75-.75h11.5a.75.75 0 0 1 .75.75V5.5h-13zM1.5 7h13v5.75a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1-.75-.75z" clipRule="evenodd" /></svg>
	);
};

export { IconApp as ReactComponent };
