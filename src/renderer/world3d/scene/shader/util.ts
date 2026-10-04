// @ts-nocheck
const composeShader = (
  precisions: string[],
  uniforms: { name: string; type: string; if?: string }[],
  inputs: { name: string; type: string; if?: string }[],
  outputs: { name: string; type: string }[],
  functions: string[],
  main: string[],
) => {
  const lines = [];

  lines.push(...precisions.map((precision) => `precision ${precision};`));

  lines.push('');
  for (const uniform of uniforms) {
    if (uniform.if) {
      lines.push(`#ifdef ${uniform.if}`);
    }

    lines.push(`uniform ${uniform.type} ${uniform.name};`);

    if (uniform.if) {
      lines.push(`#endif`);
    }
  }

  lines.push('');
  for (const input of inputs) {
    if (input.if) {
      lines.push(`#ifdef ${input.if}`);
    }

    lines.push(`in ${input.type} ${input.name};`);

    if (input.if) {
      lines.push(`#endif`);
    }
  }

  lines.push('');
  lines.push(...outputs.map((output) => `out ${output.type} ${output.name};`));

  lines.push('');
  lines.push(...functions);

  lines.push('');
  lines.push('void main() {');
  lines.push(...main);
  lines.push('}');

  lines.push('');

  return lines.join('\n');
};

export { composeShader };
