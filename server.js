const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const mysql = require('mysql2');
const app = express();
const path = require('path');
const bodyParser = require('body-parser');

const multer = require('multer');
const xlsx = require('xlsx');
const PDFDocument = require('pdfkit');
const fs = require('fs');
//const { connect } = require('http2');
require('dotenv').config();

timezone: 'America/Tijuana'

// Middleware para verificar el rol de usuario
function requireRole(...roles) {
  return (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.tipo_usuarios)) { // Cambiar a tipo_usuario
      next();
    } else {
      res.status(403).send('Acceso denegado');
    }
  };
}

// Middleware para verificar el inicio de sesión
function requireLogin(req, res, next) {
  if (!req.session.user) {
      return res.redirect('/login.html');
  }
  next();
}

// Configuración de la sesión
app.use(session({
  secret: 'secretKey',
  resave: false,
  saveUninitialized: false,
}));

app.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());


// Configurar conexión a MySQL
const connection = mysql.createConnection({
  host: process.env.DB_HOST,     
  user: process.env.DB_USER,       
  password: process.env.DB_PASSWORD,   
  database: process.env.DB_NAME    
});

connection.connect(err => {
  if (err) {
    console.error('Error conectando a MySQL:', err);
    return;
  }
  console.log('Conexión exitosa a MySQL');
});


app.post('/registrar', async (req, res) => {
  const { nombre_usuario, password, codigos_acceso, correo } = req.body;

  console.log('Datos recibidos:', { nombre_usuario, password, codigos_acceso, correo });

  const query = 'SELECT tipo_usuario FROM codigos_acceso WHERE codigo = ?';
  connection.query(query, [codigos_acceso], (err, results) => {
      if (err) {
          console.error('Error en la consulta SQL:', err);
          return res.status(500).send('Error interno del servidor.');
      }

      console.log('Resultados de la consulta SQL:', results);

      if (results.length === 0) {
          return res.status(404).send('Código de acceso inválido.');
      }

      const tipo_usuario = results[0].tipo_usuario;
      const hashedPassword = bcrypt.hashSync(password, 10);

      const insertUser = 'INSERT INTO usuarios (nombre_usuario, password_hash, tipo_usuarios, correo) VALUES (?, ?, ?, ?)';
      connection.query(insertUser, [nombre_usuario, hashedPassword, tipo_usuario, correo], (err) => {
          if (err) {
              console.error('Error al registrar usuario:', err);
              return res.status(500).send('Error al registrar usuario.');
          }
          console.log('Usuario registrado con éxito.');
          res.redirect('/login.html');
      });
  });
});

// Iniciar sesión
app.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body;

  const query = 'SELECT * FROM usuarios WHERE nombre_usuario = ?';
  connection.query(query, [nombre_usuario], (err, results) => {
      if (err) {
          return res.send('Error al obtener el usuario');
      }

      if (results.length === 0) {
          return res.send('Usuario no encontrado');
      }

      const user = results[0];

      const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
      if (!isPasswordValid) {
          return res.send('Contraseña incorrecta');
      }

      // Almacenar la información del usuario en la sesión
      req.session.user = {
        id: user.id,
        nombre_usuario: user.nombre_usuario,
        tipo_usuarios: user.tipo_usuarios
    };    

      res.redirect('/');
  });
});

// Ruta para obtener el tipo de usuario actual
app.get('/tipo-usuarios', requireLogin, (req, res) => {
  res.json({ tipo_usuarios: req.session.user.tipo_usuarios });
});


// Rutas protegidas
app.get('/medicos-registro', requireLogin,requireRole('admin','enfermero'), (req, res) => {
  connection.query('SELECT * FROM medicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Registro de Medicos en el Hospital Angeles</title>
    </head>
    <body>
      <h1>Registro de Medicos Actualizado</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Especialidad</th>
            <th>Departamento</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(medicos => {
    html += `
      <tr>
            <td>${medicos.id}</td>
            <td>${medicos.nombre}</td>
            <td>${medicos.especialidad}</td>
            <td>${medicos.departamento_id}</td>
          </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/departamentos', requireLogin, requireRole('admin', 'medico', 'enfermero'), (req, res) => {
  const query = 'SELECT * FROM vista_medicos_departamentos';
  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Médicos Registrados</title>
      </head>
      <body>
        <h1>Médicos y su ubicación en el Hospital Ángeles</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Especialidad</th>
              <th>Ubicación del departamento</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(medico => {
      html += `
        <tr>
          <td>${medico.nombre}</td>
          <td>${medico.especialidad}</td>
          <td>${medico.departamento}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});

//Ruta para registrar medicos
app.get('/inicio', requireLogin, requireRole('admin','enfermero'), (req, res) => {
  const query = 'START TRANSACTION;';
  connection.query(query, (err, result) => {
    if (err) {
      return res.send('Error al insertar el medico.');
    }
    res.redirect('/medicos.html');
  });
});

app.post('/medicos', requireLogin, requireRole('admin','enfermero'), (req, res) => {
  const { nombre, especialidad, departamento_id } = req.body;
  const query = 'INSERT INTO medicos (nombre, especialidad, departamento_id) VALUES (?, ?, ?)';

  connection.query(query,[nombre, especialidad, departamento_id], (err, result) => {
    if (err) {
      return res.send('Error al copturar médico.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <h1> Médico ${nombre} guardado con éxito</h1>
    </head>
  `;

  html += `
      <button onclick="window.location.href='/'">Volver</button>
    </html>
  `;
  res.send(html);
});
});

app.get('/aceptar', requireLogin,requireRole('admin','enfermero'), (req, res) => {
  connection.query('COMMIT;') 
  connection.query('SELECT * FROM medicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Registro de Medicos en el Hospital Angeles</title>
    </head>
    <body>
      <h1>Registro de Medicos Actualizado</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Nombre</th>
            <th>Especialidad</th>
            <th>Departamento</th>
          </tr>
        </thead>
        <tbody>
  `;

  results.forEach(medicos => {
    html += `
      <tr>
            <td>${medicos.id}</td>
            <td>${medicos.nombre}</td>
            <td>${medicos.especialidad}</td>
            <td>${medicos.departamento_id}</td>
          </tr>
    `;
  });

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/cancelar', requireLogin,requireRole('admin', 'enfermero'), (req, res) => {
  connection.query('ROLLBACK;') 
  connection.query('SELECT * FROM medicos', (err, results) => {
    if (err) {
      return res.send('Error al obtener los de la tabla.');
    }
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <title>Registro de Medicos</title>
    </head>
    <body>
      <h1>Contratacion Cancelada</h1>
        <tbody>
  `;

  html += `
        </tbody>
      </table>
      <button onclick="window.location.href='/'">Volver</button>
    </body>
    </html>
  `;

    res.send(html);
  });
});

app.get('/buscar', (req, res) => {
  const query = req.query.query;
  const sql = `SELECT nombre, especialidad FROM medicos WHERE nombre LIKE ?`;
  connection.query(sql, [`%${query}%`], (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// Ruta para registrar una cita
app.post('/citas', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  const { nombre_doc, causa, fecha_programada, departamento_id } = req.body;

  // Consulta de inserción a la tabla de citas
  const query = `
    INSERT INTO citas (nombre_doc, causa, fecha_programada, departamento_id)
    VALUES (?, ?, ?, ?)
  `;
console.log(departamento_id)
  connection.query(query, [nombre_doc, causa, fecha_programada, departamento_id], (err, result) => {
    if (err) {
      console.error('Error al insertar la cita:', err);
      return res.status(500).send('Error al registrar la cita.');
    }

    // Redirección tras éxito
    res.redirect('/citas-registro');
  });
});

// Ruta para ver citas agendadas
app.get('/citas-registro', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  const query = 'SELECT * FROM vista_citas';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener las citas:', err);
      return res.status(500).send('Error al obtener las citas.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Citas Agendadas</title>
      </head>
      <body>
        <h1>Citas Agendadas</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre del Médico</th>
              <th>Causa</th>
              <th>Fecha Programada</th>
              <th>Departamento</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    results.forEach(cita => {
      html += `
        <tr>
          <td>${cita.nombre_doc}</td>
          <td>${cita.causa}</td>
          <td>${cita.fecha_programada}</td>
          <td>${cita.ubicacion}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});


// Ruta para cargar el formulario de edición de pacientes
app.get('/editar-medicos', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editar-medicos.html'));
});

// Ruta para obtener un paciente por su ID (para el formulario de edición)
app.get('/obtener-medico/:id', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  const { id } = req.params;
  const query = 'SELECT * FROM medicos WHERE id = ?';
  connection.query(query, [id], (err, results) => {
    if (err) return res.status(500).send('Error al obtener el médico');
    if (results.length === 0) return res.status(404).send('Médico no encontrado');
    res.json(results[0]);
  });
});

// Ruta para actualizar los datos de un paciente
app.post('/editar-medicos', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  const { id, nombre, especialidad, departamento_id } = req.body;
  const query = 'UPDATE medicos SET nombre = ?, especialidad = ?, departamento_id = ? WHERE id = ?';
  connection.query(query, [nombre, especialidad, departamento_id, id], (err, result) => {
    if (err) return res.send('Error al actualizar los datos del médico.');
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <h1> Médico ${nombre} actualizado con éxito</h1>
    </head>
  `;

  html += `
      <button onclick="window.location.href='/'">Volver</button>
    </html>
  `;
  res.send(html);
});
});

// Ruta para eliminar un paciente
app.delete('/eliminar-medico/:id', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  const { id } = req.params; 
  
  const query = 'DELETE FROM medicos WHERE id = ?';
  connection.query(query, [id], (err, result) => {
    if (err) return res.status(500).send('Error al eliminar el médico');
    if (result.affectedRows === 0) return res.status(404).send('Médico no encontrado');
    res.redirect('/medicos.html');
  });  
    let html = `
    <html>
    <head>
      <link rel="stylesheet" href="/styles.css">
      <h1> Médico con ID: ${id} eliminado con éxito</h1>
    </head>
  `;

  html += `
      <button onclick="window.location.href='/'">Volver</button>
    </html>
  `;
  res.send(html);
});



//Ruta para modificar las características de las tablas (como agregar o eliminar columnas)
// Ruta para eliminar una columna 
app.post('/eliminar-columna', (req, res) => {
  const { columna } = req.body;

  if (!columna) {
      return res.status(400).send('Por favor proporciona un nombre de columna válido.');
  }

  const query = `ALTER TABLE equipos DROP COLUMN ${columna}`;

  connection.query(query, (err, result) => {
      if (err) {
          console.error('Error eliminando la columna:', err);
          return res.status(500).send('Hubo un error eliminando la columna.');
      }
      let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <h1> La columna ${columna} ha sido eliminada con éxito</h1>
      </head>
    `;
  
    html += `
        <button onclick="window.location.href='/'">Volver</button>
      </html>
    `;
    res.send(html);
  });

});

//Ruta de subconsultas
app.get('/ubicacion-medicos', requireLogin, requireRole('admin', 'medico', 'enfermero'), (req, res) => {
  const { especialidad_search } = req.query;
  let query = `
    SELECT medicos.nombre, departamentos.ubicacion 
    FROM medicos 
    JOIN departamentos 
    ON medicos.departamento_id = departamentos.id
    WHERE 1=1
  `;
  if (especialidad_search) {
    query += ` AND medicos.especialidad LIKE '%${especialidad_search}%'`;
  }
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error al ejecutar la consulta:', err);
      return res.send('Error al obtener los datos.');
    }
    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Búsqueda de Médicos por Especialidad</title>
      </head>
      <body>
        <h1>Resultados de Búsqueda</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre del Médico</th>
              <th>Ubicación</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(medico => {
      html += `
        <tr>
          <td>${medico.nombre}</td>
          <td>${medico.ubicacion}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});



//Rutas de funciones de agregación (por ejemplo, SUM, AVG, COUNT, etc.)
app.get('/ordenar-departamentos', requireLogin, requireRole('admin', 'enfermero'), (req, res) => {
  const query = 'SELECT departamentos.nombre, COUNT(medicos.id) AS num_empleados FROM medicos JOIN departamentos ON medicos.departamento_id = departamentos.id GROUP BY departamentos.nombre;';

  connection.query(query, (err, results) => {
    if (err) {
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Cantidad de Medicos en cada área del hospital</title>
      </head>
      <body>
        <h1>Departamentos agrupados</h1>
        <table>
          <thead>
            <tr>
              <th>Nombre del Área</th>
              <th>Cantidad de médicos en el área</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(departamento => {
      html += `
        <tr>
          <td>${departamento.nombre}</td>
          <td>${departamento.num_empleados}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;

    res.send(html);
  });
});


app.get('/medicos-totales', requireLogin, requireRole('enfermero', 'admin'), (req, res) => {
  const { especialidad_search } = req.query;
  let query = `
    SELECT COUNT(id) AS total_medicos FROM medicos WHERE especialidad LIKE '%${especialidad_search}%'
    `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error al ejecutar la consulta:', err);
      return res.send('Error al obtener los datos.');
    }

    let html = `
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <title>Búsqueda de Médicos Totales por Especialidad</title>
      </head>
      <body>
        <h1>Resultados de Búsqueda</h1>
        <table>
          <thead>
            <tr>
              <th>Número de Médicos Totales</th>
            </tr>
          </thead>
          <tbody>
    `;

    results.forEach(medico => {
      html += `
        <tr>
          <td>${medico.total_medicos}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
        <button onclick="window.location.href='/'">Volver</button>
      </body>
      </html>
    `;
    res.send(html);
  });
});


//Rutas para carga y descarga de archivos
// Ruta para generar y descargar un archivo PDF
app.get('/download-pdf', requireLogin, (req, res) => {
  const query = 'SELECT * FROM equipos';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error al obtener los equipos:', err);
      return res.status(500).send('Error al generar el archivo PDF.');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="equipos_medicos.pdf"');

    const doc = new PDFDocument();

    doc.pipe(res);

    doc.text('Lista de Equipos Médicos', { align: 'center', underline: true });
    doc.moveDown(2);

    results.forEach(row => {
      doc.text(`Nombre: ${row.nombre}`);
      doc.text(`Descripción: ${row.descripcion}`);
      doc.text(`Departamento: ${row.departamento}`);
      doc.text(`Estado: ${row.estado}`);
      doc.text(`Precio: ${row.precio}`);
      doc.moveDown(1);
    });

    doc.end();
  });
});


const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('excelFile'), async (req, res) => {
  try {
    const filePath = req.file.path;
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

    const insertPromises = data.map(row => {
      const { nombre, descripcion, departamento, estado, precio } = row;

      if (isNaN(precio) || precio < 0) {
        return Promise.reject(`Valor inválido para "precio" en la fila: ${JSON.stringify(row)}`);
      }

      const sql = `INSERT INTO equipos (nombre, descripcion, departamento, estado, precio) VALUES (?, ?, ?, ?, ?)`;
      return new Promise((resolve, reject) => {
        connection.query(sql, [nombre, descripcion, departamento, estado, parseFloat(precio)], err => {
          if (err) {
            reject(`Error en la fila ${JSON.stringify(row)}: ${err.message}`);
          } else {
            resolve();
          }
        });
      });
    });
    await Promise.all(insertPromises);

    res.send(`
      <html>
      <head>
        <link rel="stylesheet" href="/styles.css">
        <h1>Archivo guardado con éxito</h1>
      </head>
      <button onclick="window.location.href='/'">Volver</button>
      </html>
    `);
  } catch (errors) {
    if (Array.isArray(errors)) {
      res.status(400).json({ message: "Error al procesar algunas filas", errors });
    } else {
      res.status(500).send(`Error del servidor: ${errors}`);
    }
  }
});


app.get('/download', (req, res) => {
  const sql = `SELECT * FROM equipos`;
  connection.query(sql, (err, results) => {
    if (err) throw err;

    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Equipos');

    const filePath = path.join(__dirname, 'uploads', 'equipos.xlsx');
    xlsx.writeFile(workbook, filePath);
    res.download(filePath, 'equipos.xlsx');
  });
});


// Cerrar sesión
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login.html');
});

// Iniciar el servidor
app.listen(14100, () => {
  console.log('Servidor escuchando en http://localhost:14100');
});
