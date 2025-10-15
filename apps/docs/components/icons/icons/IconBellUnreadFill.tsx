// Generated from svgs/IconBellUnreadFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconBellUnreadFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 0c.965 0 1.853.164 2.636.487A3.5 3.5 0 0 0 14 5.965v3.659c0 .212.022.345.062.438.14.33.351.619.614.978q.143.194.305.424c.362.516.781 1.2.77 2.047a.75.75 0 0 1-.606.725h-.004l-.007.002-.026.005-.096.017a30.51 30.51 0 0 1-1.76.236c-.86.09-1.997.18-3.386.224a2 2 0 0 1-3.732 0 47 47 0 0 1-3.385-.224 31 31 0 0 1-1.76-.236l-.097-.017-.026-.005-.007-.001H.856l-.001-.001a.75.75 0 0 1-.605-.725c-.012-.848.407-1.531.77-2.047q.161-.23.304-.424c.263-.359.474-.647.614-.978.04-.093.062-.226.062-.438V6c0-1.775.556-3.293 1.632-4.368S6.226 0 8 0" /><circle cx="13.5" cy="2.5" r="2.5" /></svg>
	);
};

export { IconBellUnreadFill as ReactComponent };
