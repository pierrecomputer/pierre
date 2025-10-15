// Generated from svgs/IconCodeStyleInline.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconCodeStyleInline = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><g opacity=".4"><path d="M2.25 13a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5zM4.17 10a1.74 1.74 0 0 0 0 1.5H2.75a.75.75 0 0 1 0-1.5zM13.25 10a.75.75 0 0 1 0 1.5h-2.42a1.74 1.74 0 0 0 0-1.5zM5.17 7a1.74 1.74 0 0 0 0 1.5H2.75a.75.75 0 0 1 0-1.5zM15.25 7a.75.75 0 0 1 0 1.5h-1.42a1.74 1.74 0 0 0 0-1.5zM4.17 4a1.74 1.74 0 0 0 0 1.5H2.75a.75.75 0 0 1 0-1.5zM11.25 4a.75.75 0 0 1 0 1.5H9.83a1.74 1.74 0 0 0 0-1.5zM5.25 1a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1 0-1.5z" /></g><path fillRule="evenodd" d="M6 7.75A.75.75 0 0 1 6.75 7h5.5a.75.75 0 0 1 0 1.5h-5.5A.75.75 0 0 1 6 7.75" clipRule="evenodd" /><path d="M5 4.75A.75.75 0 0 1 5.75 4h2.5a.75.75 0 0 1 0 1.5h-2.5A.75.75 0 0 1 5 4.75M5 10.75a.75.75 0 0 1 .75-.75h3.5a.75.75 0 0 1 0 1.5h-3.5a.75.75 0 0 1-.75-.75" /></svg>
	);
};

export { IconCodeStyleInline as ReactComponent };
