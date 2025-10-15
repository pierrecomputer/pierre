// Generated from svgs/IconMap.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconMap = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M15.665.125A.75.75 0 0 1 16 .75v12.5a.75.75 0 0 1-.459.691l-4.75 2a.75.75 0 0 1-.57.005l-4.714-1.885-4.466 1.88A.75.75 0 0 1 0 15.25V2.75a.75.75 0 0 1 .459-.691l4.75-2a.75.75 0 0 1 .57-.005l4.714 1.885L14.959.06a.75.75 0 0 1 .706.066M9.75 3.258l-3.5-1.4v10.884l3.5 1.4zm1.5 10.862 3.25-1.368V1.88l-3.25 1.368zm-6.5-1.368V1.88L1.5 3.248V14.12z" clipRule="evenodd" /></svg>
	);
};

export { IconMap as ReactComponent };
