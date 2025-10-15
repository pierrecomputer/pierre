// Generated from svgs/IconExtensions.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconExtensions = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M9.5 0a1 1 0 0 0-1 1v5.5a1 1 0 0 0 1 1H15a1 1 0 0 0 1-1V1.75A1.75 1.75 0 0 0 14.25 0zm.5 6V1.5h4.25a.25.25 0 0 1 .25.25V6z" clipRule="evenodd" /><path fillRule="evenodd" d="M1.75 2.5A1.75 1.75 0 0 0 0 4.25v10C0 15.216.784 16 1.75 16h10a1.75 1.75 0 0 0 1.75-1.75V9.5a1 1 0 0 0-1-1h-5v-5a1 1 0 0 0-1-1zM6 4v4.5H1.5V4.25A.25.25 0 0 1 1.75 4zm0 6H1.5v4.25c0 .138.112.25.25.25H6zm1.5 0v4.5h4.25a.25.25 0 0 0 .25-.25V10z" clipRule="evenodd" /></svg>
	);
};

export { IconExtensions as ReactComponent };
