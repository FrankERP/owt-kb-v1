# Review log — retiro de miembros (roadmap + P1 + P2)

**Estado: LOOP DETENIDO SIN APROBACIÓN.** Ninguna ronda terminó en `APPROVED`. Este log
registra cinco rondas sobre el roadmap padre y la razón estructural por la que detenerlo fue
mejor que seguir. **La aprobación de un plan nunca autoriza implementar, y aquí no hay
aprobación de nada.**

## Tier y por qué

| Artefacto | Tier | Derivación |
|---|---|---|
| Roadmap (padre) | Estándar | La escalera dice que los roadmaps padres son estándar salvo que posean directamente un contrato crítico. No lo posee: lo poseen los hijos. Un `APPROVED` fresco bastaría. |
| P1 | **Crítico** | R7 crea una ruta de escritura nueva sobre `disabled`, el campo que `isMemberActive` lee para permitir o negar toda petición. "auth/security/ACL boundary" está en la escalera. **Derivado de la escalera, no elevado por precaución** — y la primera versión lo clasificó como estándar, que era un error. |
| P2 | **Crítico** | Writer destructivo de producción. |

## Rondas

| # | Digest revisado | Commit | Veredicto | Bloqueadores verificados |
|---|---|---|---|---|
| 1 | `7831292f18a20c04` | `73ac6d05` | CHANGES_REQUIRED | 2 |
| 2 | `379aa60745555ba3` | `8fd6771a` | CHANGES_REQUIRED | 3 |
| — | *consolidación* | `94d9b63c` | — | (fuente única de texto normativo) |
| 3 | `1a3429a094402efa` | `1453c1ce` | CHANGES_REQUIRED | 2 |
| 4 | `92358b87e85859a5` | *(en el mismo)* | CHANGES_REQUIRED | 3 |
| 5 | `79a1a79bf6e6fef8` | `(este)` | CHANGES_REQUIRED | 3 |

Digest final sin revisar: roadmap `03ca9aac8adf6922`, P1 `be05bfab47c1b2a3`.

## Bloqueadores, disposición y evidencia comprobada

**Todos verificados contra el código antes de aceptarse. Ninguno se aceptó por plausible.**

| # | Bloqueador | Disposición | Evidencia que comprobé |
|---|---|---|---|
| 1.1 | "Filtrar enumeración" no saca a un retirado de los pools | fixed | `plannerModel.ts:566-568` cae al id crudo; `:641-645` lo usa; `:648-661` reinyecta |
| 1.2 | `PATCH` de miembro NO es super-admin-only (afirmación falsa mía) | fixed | `route.ts:19-22` lo rechaza; `AdminPanel.tsx:566` |
| 2.1 | Colisiones de id `R8`/`R10` y tres requisitos sin fila | fixed | grep de las tres tablas |
| 2.2 | Bloqueo del último super-admin, sin nombrar | fixed → R14 | `auth.ts:52,79`; `proxy.ts:15-19` |
| 2.3 | La justificación de partición decía "P1 estándar" tras cambiarlo a crítico | fixed | lectura del propio documento |
| 3.1 | R10 exigía un estado que el solver rechaza | fixed → D7/R15 | `owt_solver_v2.py:466-467`, `:279-280`; `plannerModel.ts:648-651,686` |
| 3.2 | La columna de dependencias usada en dos sentidos | fixed | filas R3 y R8 contra la secuencia |
| 4.1 | Rollback de P1 declarado sin pérdida, con R15 borrando reglas | fixed | D7 vs la celda de rollback |
| 4.2 | `availabilityRules` es una **segunda** fuente de nombres en `dsl_rules`, sin dueño | fixed | `plannerModel.ts:666-678` vs `:653-657`; `owt_solver_v2.py:282-287,358-363` |
| 4.3 | La aceptación del padre contradecía R15 | fixed | línea 74 vs `p1:111` |
| 5.1 | R15 escribe el `solverConfig` sin guarda de revisión | fixed → R15b | `api/admin/solver-config/route.ts:37-41,125` — "It can never accept a stale `_rev`" |
| 5.2 | D8 y la pregunta abierta 3 de P1 daban instrucciones opuestas | fixed | D8 en el roadmap vs `p1:216` |
| 5.3 | R15 estrechó la condición del usuario sin declararlo | fixed | `owt_solver_v2.py:732-741` (`sum(terms) >= 1`), `:321` |

No refuté ningún bloqueador: los trece resultaron ciertos.

## No bloqueantes adoptados

Conteo de exenciones (tres veces mal, en tres rondas distintas), deriva de números de línea,
la columna de dependencias aplicada de forma despareja, el alcance del guard limitado a `app/**`
mientras `auth.ts` queda fuera, `retiredFrom` escribible desde Studio saltándose R15, y "el
borrado falla" afirmado como hecho cuando la tabla de suposiciones lo lista como no probado.

## Fallos de proceso del autor — la mitad del registro que más vale

1. **Leí el código y no el comentario encima.** En la ronda 1 cité la reinyección de
   `extraSupport` como el defecto que R10 debía eliminar. Cuatro líneas arriba el código dice
   por qué existe: *"omitting this is a 422 in production"*. Confundí un guard con un bug y
   construí un requisito sobre esa lectura. Exactamente contra lo que advierte el CLAUDE.md.
2. **Afirmé un hecho de ACL sin comprobarlo** y derivé de él un default que ensanchaba
   permisos.
3. **Clasifiqué mal el tier de P1** como estándar, y sólo la revisión lo corrigió.
4. **Estreché la condición explícita de Frank** ("si involucra alguien más") a "si la regla
   muere", sin declararlo como desviación.
5. **La misma clase de defecto reapareció cinco rondas seguidas:** una corrección que llega a
   una sección y no a su gemela. La consolidación de la ronda 2/3 la cerró para el *texto de
   requisitos*, y volvió a aparecer en **prosa, decisiones y preguntas abiertas** — secciones
   que la regla de fuente única no cubría.
6. **El cap de churn se alcanzó en la ronda 2** y se registró antes de despachar nada más;
   Frank dio el visto bueno explícito para consolidar y reanudar. Las rondas 3-5 corren bajo
   esa autorización.

## Por qué se detuvo aquí, y no en otra ronda

Las rondas 3, 4 y 5 encontraron cada una un defecto **sustantivo y nuevo** — o sea, el loop
funcionaba. Pero los siete bloqueadores de esas tres rondas caen todos en el mismo sitio:
**R10 y R15, la interacción entre el retiro y el solve request**. El eje de retiro en sí, el
filtro, el kill switch y el endurecimiento del borrado llevan tres rondas limpios.

Eso no es un artefacto que necesite otra ronda: es un artefacto que contiene dos proyectos.
R10/R15 tocan `buildSolveRequest`, el contrato DSL del solver, un documento compartido con
guarda de revisión multi-admin, y un borrado irreversible. La recomendación registrada es
sacarlos de P1 a un hijo propio antes de volver a revisar.

## Cambios posteriores a la última ronda — SIN REVISAR

Todo lo listado como `fixed` en la ronda 5, más los no bloqueantes de esa ronda, es material
posterior al último veredicto. Ninguna ronda ha visto los digests finales.
