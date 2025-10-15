// Generated from svgs/IconTableColumnDelete.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconTableColumnDelete = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M2.25 16A2.25 2.25 0 0 1 0 13.75V2.25A2.25 2.25 0 0 1 2.25 0H9v1.5H6.5v5.75H9v1.5H6.5v5.75H9V16zM5 14.5V8.75H1.5v5c0 .414.336.75.75.75zM1.5 7.25H5V1.5H2.25a.75.75 0 0 0-.75.75z" opacity=".4" /><path d="M10.75 16a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 1.5 0v.25h.25a.75.75 0 0 1 0 1.5zm0-3.5a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75m0-3.5a.75.75 0 0 1-.75-.75v-.5a.75.75 0 0 1 1.309-.5h.441a.75.75 0 0 1 0 1.5h-.441a.75.75 0 0 1-.559.25m0-3a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75m0-3.5a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 0 1.5h-.25v.25a.75.75 0 0 1-.75.75m2.75 12.75a.75.75 0 0 1 .75-.75h.25v-.25a.75.75 0 0 1 1.5 0v.25a1.5 1.5 0 0 1-1.5 1.5h-.25a.75.75 0 0 1-.75-.75m0-7.25a.75.75 0 0 1 .75-.75h.441a.75.75 0 0 1 1.309.5v.5a.75.75 0 0 1-1.309.5h-.441A.75.75 0 0 1 13.5 8m0-7.25a.75.75 0 0 1 .75-.75h.25A1.5 1.5 0 0 1 16 1.5v.25a.75.75 0 0 1-1.5 0V1.5h-.25a.75.75 0 0 1-.75-.75m1.75 11.75a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75m0-6.5a.75.75 0 0 1-.75-.75v-1a.75.75 0 0 1 1.5 0v1a.75.75 0 0 1-.75.75" /></svg>
	);
};

export { IconTableColumnDelete as ReactComponent };
