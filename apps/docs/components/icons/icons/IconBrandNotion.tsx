// Generated from svgs/IconBrandNotion.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBrandNotion = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M9.816.036.963.69C.249.752 0 1.22 0 1.778v9.706c0 .435.155.808.528 1.306l2.081 2.707c.342.435.653.529 1.306.498l10.28-.623c.87-.062 1.119-.466 1.119-1.15V3.301c0-.353-.14-.455-.551-.757l-.07-.051-2.827-1.99c-.684-.497-.964-.56-2.051-.467M4.147 3.124c-.84.056-1.03.07-1.507-.319l-1.212-.964c-.123-.125-.061-.28.25-.311l8.51-.622c.715-.063 1.087.186 1.367.404l1.46 1.058c.062.031.217.217.03.217l-8.79.53zm-.979 11.004v-9.27c0-.404.125-.59.497-.622l10.095-.591c.342-.031.497.187.497.59v9.208c0 .405-.062.747-.621.778l-9.66.56c-.56.031-.808-.155-.808-.653m9.536-8.772c.062.28 0 .56-.28.592l-.465.092v6.844c-.404.217-.777.342-1.088.342-.497 0-.621-.156-.993-.622l-3.045-4.79v4.634l.963.218s0 .56-.777.56l-2.142.124c-.063-.124 0-.435.217-.497l.56-.155V6.57l-.777-.063c-.063-.28.093-.685.528-.716l2.298-.155 3.168 4.853V6.196l-.807-.093c-.062-.343.186-.592.496-.622z" clip-rule="evenodd"/></svg>
	);
};

export { IconBrandNotion as ReactComponent };