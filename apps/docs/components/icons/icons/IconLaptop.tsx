// Generated from svgs/IconLaptop.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconLaptop = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M3.25 2A2.25 2.25 0 0 0 1 4.25v8.25h14V4.25A2.25 2.25 0 0 0 12.75 2zM2.5 4.25a.75.75 0 0 1 .75-.75h9.5a.75.75 0 0 1 .75.75V11h-11z" clipRule="evenodd" /><path d="M16 13H0a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 16 13" /></svg>
	);
};

export { IconLaptop as ReactComponent };
