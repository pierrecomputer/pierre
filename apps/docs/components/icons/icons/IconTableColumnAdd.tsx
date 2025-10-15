// Generated from svgs/IconTableColumnAdd.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconTableColumnAdd = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2.25 16A2.25 2.25 0 0 1 0 13.75V2.25A2.25 2.25 0 0 1 2.25 0H9v1.5H6.5v5.75H9v1.5H6.5v5.75H9V16zM5 14.5V8.75H1.5v5c0 .414.336.75.75.75zM1.5 7.25H5V1.5H2.25a.75.75 0 0 0-.75.75z" opacity=".4" /><path d="M10.75 16a.75.75 0 0 1-.75-.75V.75a.75.75 0 0 1 .75-.75h3A2.25 2.25 0 0 1 16 2.25v11.5A2.25 2.25 0 0 1 13.75 16zm.75-1.5h2.25a.75.75 0 0 0 .75-.75v-5h-3zm0-7.25h3v-5a.75.75 0 0 0-.75-.75H11.5z" /></svg>
	);
};

export { IconTableColumnAdd as ReactComponent };
