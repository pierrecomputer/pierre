// Generated from svgs/IconHeart.svg

import { type Color, Colors } from "../Color";

interface IconProps {
	size?: 10 | 12 | 16 | 20 | 32 | 48 | "1em";
	color?: keyof Color | "currentcolor";
	style?: React.CSSProperties;
	className?: string;
}

// prettier-ignore
export const IconHeart = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 2.256C6.732 1.028 5.29.453 3.936.503c-1.578.059-2.933.97-3.562 2.454-.624 1.472-.496 3.4.603 5.497 1.1 2.098 3.187 4.41 6.586 6.745L8 15.5l.438-.3c3.398-2.336 5.485-4.648 6.585-6.746 1.099-2.097 1.227-4.025.603-5.497-.63-1.483-1.984-2.395-3.562-2.454C10.71.453 9.268 1.028 8 2.256m0 11.383c-2.995-2.131-4.752-4.16-5.66-5.89-.95-1.813-.95-3.256-.55-4.2.397-.934 1.22-1.484 2.204-1.52.992-.038 2.251.452 3.416 1.84l.59.703.59-.704c1.165-1.387 2.424-1.877 3.416-1.84.984.037 1.807.587 2.203 1.52.4.945.4 2.388-.55 4.201-.907 1.73-2.664 3.759-5.659 5.89" /></svg>
	);
};

export { IconHeart as ReactComponent };
