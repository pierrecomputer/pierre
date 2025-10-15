// Generated from svgs/IconGlobe.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconGlobe = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0m-8.428 6.486c.008-.276.103-.637.204-1.018.146-.55.302-1.14.22-1.572-.118-.625-.708-.823-1.285-1.017-.596-.2-1.178-.397-1.213-1.053-.029-.535.342-.9.757-1.31q.12-.117.242-.242c.05-.052-.263-.23-.743-.502-1.036-.589-2.856-1.622-3.51-2.793a6.5 6.5 0 0 0 5.328 9.508M14.5 8a6.5 6.5 0 0 1-5.507 6.425c1.355-1.043 2.84-3.106 3-4.6.139-1.285-1.998-2.069-3.497-2.586-.478-.165-.755.084-.99.294-.172.154-.32.288-.51.223-.444-.153-2.498-2.07-1.498-2.587.78-.404.951-.177 1.226.188.078.103.163.216.273.33.608.314.661-.137.722-.655.04-.334.082-.695.277-.898.434-.448 1.264-.818 2.027-1.158.471-.21.917-.409 1.226-.607A6.5 6.5 0 0 1 14.5 8" clipRule="evenodd" /></svg>
	);
};

export { IconGlobe as ReactComponent };
