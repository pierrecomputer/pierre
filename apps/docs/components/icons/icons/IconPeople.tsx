// Generated from svgs/IconPeople.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPeople = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.5 3.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0M5.7 10.042A7.88 7.88 0 0 1 11 8c2.036 0 3.895.773 5.3 2.042a3.64 3.64 0 0 1 1.193 2.892c-.067 1.051-.65 2.07-1.818 2.498-1.19.435-2.736.568-4.675.568s-3.486-.133-4.675-.568c-1.168-.428-1.75-1.447-1.818-2.498A3.64 3.64 0 0 1 5.7 10.042" /><path d="M6.748 8.081A9 9 0 0 0 5.029 9.3a4.64 4.64 0 0 0-1.52 3.698c.044.68.257 1.368.654 1.962-1.006-.061-1.859-.198-2.566-.457C.575 14.129.065 13.237.006 12.317a3.18 3.18 0 0 1 1.044-2.53A6.9 6.9 0 0 1 6.748 8.08M7.06 1.324A4.5 4.5 0 0 0 6.5 3.5c0 1.13.416 2.162 1.103 2.952a3.063 3.063 0 1 1-.543-5.128" opacity=".4" /></svg>
	);
};

export { IconPeople as ReactComponent };
