// Generated from svgs/IconCodeBlock.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconCodeBlock = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.31 6.248a.75.75 0 1 0-1.12-.996l-2 2.25a.75.75 0 0 0 0 .996l2 2.25a.75.75 0 1 0 1.12-.996L5.754 8zM8.752 5.19a.75.75 0 0 0-.063 1.058L10.246 8 8.69 9.752a.75.75 0 0 0 1.122.996l2-2.25a.75.75 0 0 0 0-.996l-2-2.25a.75.75 0 0 0-1.06-.063"/><path d="M8 0C6.484 0 5.216.078 4.175.307c-1.05.23-1.916.623-2.58 1.288C.93 2.259.537 3.125.307 4.175.078 5.216 0 6.484 0 8s.078 2.784.307 3.825c.23 1.05.623 1.916 1.288 2.58.664.665 1.53 1.058 2.58 1.289C5.216 15.922 6.484 16 8 16s2.784-.078 3.825-.306c1.05-.23 1.916-.624 2.58-1.289s1.058-1.53 1.289-2.58C15.922 10.784 16 9.516 16 8s-.078-2.784-.306-3.825c-.23-1.05-.624-1.916-1.289-2.58S12.875.537 11.825.307C10.784.078 9.516 0 8 0M1.5 8c0-1.484.078-2.622.272-3.503.191-.873.485-1.443.883-1.842.399-.398.97-.692 1.842-.883C5.377 1.578 6.517 1.5 8 1.5s2.622.078 3.503.272c.873.191 1.443.485 1.842.883.398.399.692.97.883 1.842.194.88.272 2.02.272 3.503s-.078 2.622-.272 3.503c-.191.873-.485 1.443-.883 1.842-.399.398-.97.692-1.842.883-.88.194-2.02.272-3.503.272s-2.622-.078-3.503-.272c-.873-.191-1.443-.485-1.842-.883-.398-.399-.692-.97-.883-1.842C1.578 10.623 1.5 9.483 1.5 8" clip-rule="evenodd"/></svg>
	);
};

export { IconCodeBlock as ReactComponent };