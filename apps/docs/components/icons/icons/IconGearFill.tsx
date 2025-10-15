// Generated from svgs/IconGearFill.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconGearFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M9.095 1.058c-.108-1.41-2.182-1.41-2.29 0-.078 1.02-1.356 1.434-2.02.655-.919-1.078-2.597.137-1.853 1.342.538.871-.251 1.955-1.248 1.714C.305 4.435-.336 6.403.976 6.94c.949.39.949 1.729 0 2.118-1.312.538-.67 2.506.708 2.172.997-.24 1.786.843 1.248 1.714-.744 1.205.934 2.42 1.853 1.342.664-.78 1.942-.365 2.02.655.108 1.41 2.182 1.41 2.29 0 .078-1.02 1.356-1.434 2.02-.655.919 1.078 2.597-.137 1.853-1.342-.538-.871.251-1.955 1.248-1.714 1.379.334 2.02-1.634.708-2.172-.949-.39-.949-1.729 0-2.118 1.312-.538.67-2.506-.708-2.172-.997.24-1.786-.843-1.248-1.714.744-1.205-.934-2.42-1.853-1.342-.664.78-1.942.365-2.02-.655M7.95 10.987A2.99 2.99 0 0 1 4.955 8c0-1.65 1.34-2.987 2.995-2.987A2.99 2.99 0 0 1 10.945 8c0 1.65-1.34 2.987-2.995 2.987" /></svg>
	);
};

export { IconGearFill as ReactComponent };
