// Generated from svgs/IconBrush.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBrush = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M5.25 2.75a2.75 2.75 0 0 1 5.5 0q0 .045-.005.088l-.424 3.605 2.38.634A1.75 1.75 0 0 1 14 8.768V9a1.25 1.25 0 0 1-.915 1.204c.045.445.096 1.037.125 1.668.03.656.037 1.37-.015 2.013-.049.607-.158 1.277-.443 1.75a.75.75 0 0 1-.643.365H2.75a.75.75 0 0 1-.651-1.122c.413-.723.655-2.013.78-3.236.055-.542.086-1.04.102-1.421A1.25 1.25 0 0 1 2 9v-.232a1.75 1.75 0 0 1 1.3-1.69l2.38-.635-.425-3.605zM8.515 14.5s.167-1.036.186-1.402l.013-.225c.017-.29.033-.582.036-.873h.75l.75.001c0 .312-.019.625-.037.936l-.016.277c-.022.404-.155 1.286-.155 1.286h1.552a5 5 0 0 0 .106-.736c.045-.553.04-1.198.012-1.823a29 29 0 0 0-.13-1.691h-7.1c-.018.407-.05.95-.11 1.545-.086.828-.233 1.827-.503 2.705zm-1.27-7.588-.494-4.2a1.25 1.25 0 0 1 2.498 0l-.494 4.2a.75.75 0 0 0 .552.813l3.007.802a.25.25 0 0 1 .185.223H3.501a.25.25 0 0 1 .185-.223l3.007-.802a.75.75 0 0 0 .552-.813" clip-rule="evenodd"/></svg>
	);
};

export { IconBrush as ReactComponent };