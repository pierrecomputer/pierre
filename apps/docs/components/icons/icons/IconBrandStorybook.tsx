// Generated from svgs/IconBrandStorybook.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBrandStorybook = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="m1.5 1.536.497 13.208a.803.803 0 0 0 .768.773l10.737.482a.806.806 0 0 0 .84-.803V.805a.805.805 0 0 0-.854-.803l-.883.055.064 1.846a.12.12 0 0 1-.132.124.12.12 0 0 1-.062-.025l-.595-.47-.704.535a.12.12 0 0 1-.192-.1l.075-1.814-8.803.551a.805.805 0 0 0-.755.832m7.51 4.65c0 .312 2.109.163 2.391-.057 0-2.131-1.143-3.251-3.237-3.251S4.896 4.015 4.896 5.72c0 1.71 1.327 2.454 2.454 3.087.833.467 1.556.874 1.556 1.562 0 .455-.222.725-.713.725-.638 0-.89-.326-.86-1.435 0-.24-2.437-.315-2.51 0-.19 2.687 1.485 3.462 3.4 3.462 1.857 0 3.313-.988 3.313-2.78 0-1.87-1.402-2.612-2.56-3.226-.815-.432-1.51-.8-1.51-1.452 0-.64.475-.725.757-.725.297 0 .832.052.787 1.247" clipRule="evenodd" /></svg>
	);
};

export { IconBrandStorybook as ReactComponent };
